import { Inject, Injectable, Logger } from '@nestjs/common';
import { IProcessApprovalJobData } from '@agent/core/infrastructure/queue';
import {
  EAgentStreamStepType,
  ECheckpointKind,
} from '@agent/core/constants';
import { MessageClientService } from '../../contracts/message-client.service';
import { AgentStreamService } from '../../contracts/agent-stream.service';
import { describeExternalServiceError } from '../loop/external-service-error.util';
import { CheckpointService } from './checkpoint.service';
import { CheckpointResponseDto } from '../../contracts/dtos/checkpoint.dto';
import { AgentCancellationService } from '../cancellation/agent-cancellation.service';
import { TurnCancelledError } from '../loop/turn-cancelled.error';
import { ApprovalSkillRecorderService } from './approval-skill-recorder.service';
import { AnswerResult } from '../orchestrator/orchestration-answer.types';
import {
  EXECUTION_ENGINE_REGISTRY,
  IExecutionEngineRegistry,
  EExecutionEngineMode,
} from '../../contracts/execution-engine.interface';

/**
 * ApprovalExecutionService
 *
 * Điều phối xử lý job phê duyệt HITL (Human-in-the-Loop) từ hàng đợi.
 * Nhiệm vụ duy nhất:
 * 1. Claim checkpoint để chống trùng lặp thực thi (idempotency).
 * 2. Ghi nhận kỹ năng học hỏi (Skill Recorder) khi người dùng duyệt tool.
 * 3. Ủy quyền tiếp tục phiên làm việc (resume) cho Execution Engine tương ứng
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
    private readonly skillRecorder: ApprovalSkillRecorderService,
    @Inject(EXECUTION_ENGINE_REGISTRY)
    private readonly engineRegistry: IExecutionEngineRegistry,
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
      await this.skillRecorder.record({
        checkpointId: checkpoint.id,
        workspaceId: checkpoint.workspaceId,
        pendingTask: checkpoint.pendingTask,
        pendingTool: checkpoint.pendingTool,
        riskLevel: checkpoint.riskLevel,
      });
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
    try {
      await work();
    } catch (error) {
      if (error instanceof TurnCancelledError) {
        this.logger.log(
          `${label}() checkpoint=${id} bị huỷ theo yêu cầu (Stop)`,
        );
        await this.messageClient.tryUpdateMessage({
          id: replyMessageId,
          userId: botUserId,
          content: error.partialText || '⏹️ Đã dừng theo yêu cầu.',
        });
      } else {
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
      await this.emitDone({
        userId,
        channelId,
        messageId: replyMessageId,
        channelType,
      });
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
