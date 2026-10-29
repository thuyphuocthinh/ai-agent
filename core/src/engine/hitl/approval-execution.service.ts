import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { IProcessApprovalJobData } from '@agent/core/infrastructure/queue';
import {
  EAgentStreamStepType,
  ECheckpointKind,
} from '@agent/core/constants';
import { MessageClientService } from '../streaming/message-client.service';
import { AgentStreamService } from '../streaming/agent-stream.service';
import { describeExternalServiceError } from '../loop/utils/external-service-error.util';
import { CheckpointService } from './checkpoint.service';
import { CheckpointResponseDto } from '../../contracts/dtos/checkpoint.dto';
import { AgentCancellationService } from '../cancellation/agent-cancellation.service';
import { TurnCancelledError } from '../loop/errors/turn-cancelled.error';
import { AnswerResult } from '../../contracts/engine/orchestration-answer.types';
import { TurnEventRecorderService } from '../orchestrator/turn/turn-event-recorder.service';
import {
  ETurnLogStatus,
  ITurnEventLog,
  TURN_EVENT_LOG,
} from '../../contracts/streaming/turn-event-log.interface';
import {
  EXECUTION_ENGINE_REGISTRY,
  IExecutionEngineRegistry,
  EExecutionEngineMode,
} from '../../contracts/engine/execution-engine.interface';
import { ActionAuditService, EReviewerType, EPolicyVerdict } from '../../security';

/**
 * ApprovalExecutionService
 *
 * Điều phối xử lý job phê duyệt HITL (Human-in-the-Loop) từ hàng đợi.
 * Nhiệm vụ duy nhất:
 * 1. Claim checkpoint để chống trùng lặp thực thi (idempotency).
 * 2. Ủy quyền tiếp tục phiên làm việc (resume) cho Execution Engine tương ứng
 *    (SingleAgentEngine, PipelineChainingEngine, hoặc DynamicSupervisorEngine).
 */
@Injectable()
export class ApprovalExecutionService {
  private readonly logger = new Logger(ApprovalExecutionService.name);

  constructor(
    private readonly messageClient: MessageClientService,
    private readonly agentStream: AgentStreamService,
    private readonly checkpoint: CheckpointService,
    private readonly cancellation: AgentCancellationService,
    @Inject(EXECUTION_ENGINE_REGISTRY)
    private readonly engineRegistry: IExecutionEngineRegistry,
    @Optional()
    @Inject(TURN_EVENT_LOG)
    private readonly eventLog?: ITurnEventLog,
    @Optional()
    private readonly turnRecorder?: TurnEventRecorderService,
    @Optional()
    private readonly actionAudit?: ActionAuditService,
  ) {}

  async processApprovalJob(data: IProcessApprovalJobData): Promise<void> {
    const checkpoint = await this.checkpoint.findById({
      id: data.checkpointId,
    });
    if (!checkpoint) {
      this.logger.error(
        `processApprovalJob() checkpoint ${data.checkpointId} not found`,
      );
      return;
    }

    const { claimed } = await this.checkpoint.claimExecution({
      id: checkpoint.id,
    });
    if (!claimed) {
      this.logger.warn(
        `processApprovalJob() checkpoint ${checkpoint.id} đã được thực thi trước đó — bỏ qua (job bị retry/redeliver)`,
      );
      return;
    }

    if (checkpoint.kind === ECheckpointKind.APPROVAL && checkpoint.pendingTool) {
      if (this.actionAudit) {
        const toolName =
          checkpoint.pendingTool.name ||
          checkpoint.pendingTask ||
          ECheckpointKind.APPROVAL;
        await this.actionAudit
          .record({
            userId: data.userId,
            tenantId: checkpoint.workspaceId,
            actionType: toolName,
            evaluationStatus: EPolicyVerdict.ALLOW,
            reviewer: EReviewerType.HUMAN,
            idempotencyKey: checkpoint.id,
            metadata: {
              approverUserId: data.userId,
              checkpointId: checkpoint.id,
              replyMessageId: checkpoint.replyMessageId,
              channelId: checkpoint.channelId,
              pendingTool: checkpoint.pendingTool,
              riskLevel: checkpoint.riskLevel,
            },
          })
          .catch((error: unknown) => {
            this.logger.warn(
              `Không thể ghi nhận nhật ký kiểm toán cho checkpoint ${checkpoint.id}: ${(error as Error)?.message}`,
            );
          });
      }
    }

    const engineMode = checkpoint.engineMode || EExecutionEngineMode.DYNAMIC_SUPERVISOR;
    const engine = this.engineRegistry.get(engineMode);

    if (engine?.resume) {
      await this.runResumableTurn(
        checkpoint,
        data.userId,
        `resume:${engine.id}`,
        async () => {
          const result = await engine.resume!(checkpoint);
          await this.finishTurn(checkpoint, result);
        },
      );
      return;
    }

    throw new Error(
      `[ApprovalExecutionService] Không tìm thấy engine "${engineMode}" hoặc engine không hỗ trợ resume cho checkpoint ${checkpoint.id}`,
    );
  }

  private async emitDone(context: {
    userId: string;
    channelId: string;
    messageId: string;
    channelType: string;
  }): Promise<void> {
    await this.agentStream
      .emitStep(context, { type: EAgentStreamStepType.DONE })
      .catch((error) =>
        this.logger.warn(
          `emitStep('done') failed: ${(error as Error).message}`,
        ),
      );
  }

  private async runResumableTurn(
    checkpoint: CheckpointResponseDto,
    userId: string,
    label: string,
    work: () => Promise<void>,
  ): Promise<void> {
    const { id, replyMessageId, botUserId, channelId, channelType } =
      checkpoint;
    await this.cancellation.startTurn(replyMessageId, userId);
    // Turn tiếp tục sau duyệt/làm rõ cũng có event log riêng (khoá theo replyMessageId)
    // để reload giữa lúc đang chạy tiếp vẫn phát lại + reconnect được.
    await this.eventLog
      ?.start({ messageId: replyMessageId, conversationId: channelId, userId })
      .catch((error: unknown) =>
        this.logger.warn(
          `Không thể khởi tạo turn log cho ${replyMessageId}: ${(error as Error)?.message}`,
        ),
      );
    const stopHeartbeat = this.eventLog?.startHeartbeat(replyMessageId);
    let finalStatus = ETurnLogStatus.DONE;
    try {
      await work();
    } catch (error) {
      if (error instanceof TurnCancelledError) {
        finalStatus = ETurnLogStatus.CANCELLED;
        this.logger.log(
          `${label}() checkpoint=${id} bị huỷ theo yêu cầu (Stop)`,
        );
        await this.messageClient.tryUpdateMessage({
          id: replyMessageId,
          userId: botUserId,
          content: error.partialText || '⏹️ Đã dừng theo yêu cầu.',
        });
      } else {
        finalStatus = ETurnLogStatus.FAILED;
        this.logger.error(
          `${label}() failed for checkpoint ${id}: ${(error as Error).message}`,
          (error as Error).stack,
        );
        await this.messageClient.tryUpdateMessage({
          id: replyMessageId,
          userId: botUserId,
          content: describeExternalServiceError(error),
        });
      }
    } finally {
      await this.turnRecorder?.idle();
      await this.emitDone({
        userId,
        channelId,
        messageId: replyMessageId,
        channelType,
      });
      stopHeartbeat?.();
      await this.eventLog?.finish(replyMessageId, finalStatus);
    }
  }

  private async finishTurn(
    checkpoint: CheckpointResponseDto,
    result: AnswerResult,
  ): Promise<void> {
    await this.messageClient.updateMessage({
      id: checkpoint.replyMessageId,
      userId: checkpoint.botUserId,
      channelId: checkpoint.channelId,
      ...result,
    });
  }
}
