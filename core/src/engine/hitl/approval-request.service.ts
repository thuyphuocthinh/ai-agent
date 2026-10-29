import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import { EJobName, EQueueName, QueueService } from '@agent/core/infrastructure/queue';
import {
  ORCHESTRATION_ERROR,
  EAgentStreamStepType,
  EApprovalAction,
  ECheckpointKind,
} from '@agent/core/constants';
import { MessageClientService } from '../streaming/message-client.service';
import { AgentStreamService } from '../streaming/agent-stream.service';
import { CheckpointService } from './checkpoint.service';
import {
  OrchestrationCheckpointStatus,
  PendingToolCall,
} from '../../contracts';
import { CheckpointResponseDto } from '../../contracts/dtos/checkpoint.dto';
import { ResolveApprovalRequestDto } from '../../contracts/dtos/orchestration.dto';
import {
  ETurnLogStatus,
  ITurnEventLog,
  TURN_EVENT_LOG,
} from '../../contracts/streaming/turn-event-log.interface';
import { TurnEventRecorderService } from '../orchestrator/turn/turn-event-recorder.service';

@Injectable()
export class ApprovalRequestService {
  private readonly logger = new Logger(ApprovalRequestService.name);

  constructor(
    private readonly messageClient: MessageClientService,
    private readonly agentStream: AgentStreamService,
    private readonly checkpoint: CheckpointService,
    private readonly queueService: QueueService,
    @Optional()
    @Inject(TURN_EVENT_LOG)
    private readonly eventLog?: ITurnEventLog,
    @Optional()
    private readonly turnRecorder?: TurnEventRecorderService,
  ) { }

  async findPendingCheckpoint(
    replyMessageId: string,
  ): Promise<CheckpointResponseDto | null> {
    return this.checkpoint.findPendingByReplyMessageId({ replyMessageId });
  }

  async findPendingByConversationId(
    conversationId: string,
  ): Promise<CheckpointResponseDto | null> {
    return this.checkpoint.findPendingByConversationId({ conversationId });
  }

  async resolveApproval(dto: ResolveApprovalRequestDto): Promise<void> {
    const checkpoint = await this.loadOwnedCheckpoint(dto);
    this.validateActionAndKind(dto, checkpoint);

    const toStatus =
      dto.action === EApprovalAction.REJECT
        ? OrchestrationCheckpointStatus.REJECTED
        : OrchestrationCheckpointStatus.APPROVED;
    const updatedPendingTool =
      dto.action === EApprovalAction.EDIT_AND_APPROVE
        ? this.validateAndApplyEditedArgs(dto, checkpoint)
        : undefined;

    const effectiveCandidateId =
      dto.selectedCandidateId ?? dto.selectedProvider;

    const { claimed } = await this.checkpoint.claim({
      id: checkpoint.id,
      toStatus,
      ...(dto.action === EApprovalAction.CLARIFY && {
        selectedProvider: effectiveCandidateId,
      }),
      ...(updatedPendingTool && { updatedPendingTool }),
    });
    if (!claimed) {
      throw new RpcException(ORCHESTRATION_ERROR.CHECKPOINT_ALREADY_RESOLVED);
    }

    if (dto.action === EApprovalAction.REJECT) {
      await this.rejectCheckpoint(checkpoint, dto.userId);
      return;
    }

    await this.enqueueApprovalJob(checkpoint, dto.userId);
  }

  private async enqueueApprovalJob(
    checkpoint: CheckpointResponseDto,
    userId: string,
  ): Promise<void> {
    try {
      await this.queueService.addJob(
        EQueueName.AI_ORCHESTRATION_QUEUE,
        EJobName.PROCESS_APPROVAL,
        { checkpointId: checkpoint.id, userId },
        { attempts: 1 },
      );
    } catch (error) {
      this.logger.error(
        `resolveApproval() failed to enqueue PROCESS_APPROVAL for checkpoint ${checkpoint.id}, reverting claim: ${(error as Error).message}`,
      );
      await this.checkpoint.revertApprovedClaim({ id: checkpoint.id });
      throw new RpcException(
        ORCHESTRATION_ERROR.CHECKPOINT_APPROVAL_ENQUEUE_FAILED,
      );
    }
  }

  private validateActionAndKind(
    dto: ResolveApprovalRequestDto,
    checkpoint: CheckpointResponseDto,
  ): void {
    const candidateId =
      dto.selectedCandidateId ?? dto.selectedProvider;
    const kindMatchesAction =
      dto.action === EApprovalAction.CLARIFY
        ? checkpoint.kind === ECheckpointKind.CLARIFICATION && Boolean(candidateId)
        : checkpoint.kind === ECheckpointKind.APPROVAL;
    if (!kindMatchesAction) {
      throw new RpcException(ORCHESTRATION_ERROR.CHECKPOINT_ACTION_MISMATCH);
    }
  }

  private validateAndApplyEditedArgs(
    dto: ResolveApprovalRequestDto,
    checkpoint: CheckpointResponseDto,
  ): PendingToolCall {
    if (!checkpoint.pendingTool || !dto.editedArgs) {
      throw new RpcException(ORCHESTRATION_ERROR.CHECKPOINT_ACTION_MISMATCH);
    }

    const originalArgs = checkpoint.pendingTool.args || {};
    const editedArgs = dto.editedArgs;
    const FORBIDDEN_KEYS = ['id', 'name'];

    const hasUnknownKey = Object.keys(editedArgs).some(
      (key) => !(key in originalArgs) || FORBIDDEN_KEYS.includes(key),
    );
    const hasForbiddenValue = Object.values(editedArgs).some(
      (value) => value === '' || value === null || value === undefined,
    );
    if (hasUnknownKey || hasForbiddenValue) {
      throw new RpcException(ORCHESTRATION_ERROR.CHECKPOINT_ACTION_MISMATCH);
    }

    return {
      ...checkpoint.pendingTool,
      args: { ...originalArgs, ...editedArgs },
    };
  }

  private async loadOwnedCheckpoint(
    dto: ResolveApprovalRequestDto,
  ): Promise<CheckpointResponseDto> {
    const checkpoint = await this.checkpoint.findPendingByReplyMessageId({
      replyMessageId: dto.messageId,
    });
    if (!checkpoint) {
      throw new RpcException(ORCHESTRATION_ERROR.CHECKPOINT_NOT_FOUND);
    }
    if (checkpoint.userId !== dto.userId) {
      this.logger.warn(
        `User ${dto.userId} tried to resolve checkpoint ${checkpoint.id} owned by ${checkpoint.userId}`,
      );
      throw new RpcException(ORCHESTRATION_ERROR.CHECKPOINT_FORBIDDEN);
    }
    return checkpoint;
  }

  private async rejectCheckpoint(
    checkpoint: CheckpointResponseDto,
    userId: string,
  ): Promise<void> {
    const { replyMessageId, botUserId, channelId, channelType } = checkpoint;
    // Từ chối cũng là 1 turn có event log: reload đúng lúc này vẫn phát lại được
    // (câu "Đã huỷ" nằm trong log trước event done).
    await this.eventLog
      ?.start({ messageId: replyMessageId, conversationId: channelId, userId })
      .catch((error: unknown) =>
        this.logger.warn(
          `Không thể khởi tạo turn log cho ${replyMessageId}: ${(error as Error)?.message}`,
        ),
      );
    let finalStatus = ETurnLogStatus.DONE;
    try {
      await this.messageClient.updateMessage({
        id: replyMessageId,
        userId: botUserId,
        content: '❌ Đã huỷ theo yêu cầu.',
      });
    } catch (error) {
      finalStatus = ETurnLogStatus.FAILED;
      throw error;
    } finally {
      await this.turnRecorder?.idle();
      await this.agentStream
        .emitStep(
          { userId, channelId, messageId: replyMessageId, channelType },
          { type: EAgentStreamStepType.DONE },
        )
        .catch((error) =>
          this.logger.warn(
            `emitStep('done') failed: ${(error as Error).message}`,
          ),
        );
      await this.eventLog?.finish(replyMessageId, finalStatus);
    }
  }
}
