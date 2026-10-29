import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import {
  EAgentStreamStepType,
  WORKER_CRASHED_AFTER_EXECUTION_MESSAGE,
  WORKER_CRASHED_EXECUTION_UNKNOWN_MESSAGE,
} from '@agent/core/constants';
import { CheckpointService } from './checkpoint.service';
import { MessageClientService } from '../streaming/message-client.service';
import { AgentStreamService } from '../streaming/agent-stream.service';
import { OrchestrationCheckpointStatus } from '../../contracts';
import { CheckpointResponseDto } from '../../contracts/dtos/checkpoint.dto';

/**
 * Giai đoạn 3 (HITL), Step 8 — checkpoint pending quá hạn (mặc định 24h, xem
 * ORCHESTRATION_CONSTANTS.CHECKPOINT_EXPIRY_MS) tự động bị từ chối, tránh 1
 * checkpoint bị người dùng bỏ quên treo "pending" vĩnh viễn.
 */
@Injectable()
export class CheckpointCleanupService {
  private readonly logger = new Logger(CheckpointCleanupService.name);

  constructor(
    private readonly checkpoint: CheckpointService,
    private readonly messageClient: MessageClientService,
    private readonly agentStream: AgentStreamService,
  ) {}

  @Cron(CronExpression.EVERY_HOUR, { name: 'expire-orchestration-checkpoints' })
  async expirePendingCheckpoints(): Promise<void> {
    const expired = await this.checkpoint.findExpiredPending();
    if (expired.length === 0) return;

    this.logger.log(
      `expirePendingCheckpoints() found ${expired.length} expired checkpoint(s)`,
    );

    await this.settleAll(
      expired,
      (checkpoint) => this.expireOne(checkpoint),
      'expireOne()',
    );
  }

  // Bug fix — checkpoint kẹt vô hình sau worker crash: status=APPROVED +
  // execution_started_at đã set (claimExecution() chạy) nhưng worker crash
  // trước khi tool và resume loop hoàn tất. findExpiredPending() không bao
  // giờ thấy vì chỉ quét PENDING — cron riêng này dọn nhánh đó.
  @Cron(CronExpression.EVERY_10_MINUTES, {
    name: 'recover-stalled-executions',
  })
  async recoverStalledExecutions(): Promise<void> {
    const stalled = await this.checkpoint.findStalledExecution();
    if (stalled.length === 0) return;

    this.logger.warn(
      `recoverStalledExecutions() found ${stalled.length} stalled checkpoint(s) — likely caused by a worker crash during tool execution`,
    );

    await this.settleAll(
      stalled,
      (checkpoint) => this.recoverOne(checkpoint),
      'recoverOne()',
    );
  }

  private async settleAll<T extends { id: string }>(
    items: T[],
    run: (item: T) => Promise<void>,
    label: string,
  ): Promise<void> {
    const results = await Promise.allSettled(items.map(run));
    results.forEach((result, i) => {
      if (result.status === 'rejected') {
        this.logger.error(
          `${label} failed for checkpoint ${items[i].id}: ${result.reason}`,
        );
      }
    });
  }

  // dùng chung claim() atomic (Step 5) — nếu user vừa bấm Approve/Reject
  // đúng lúc job này chạy, claim() thua cuộc đua (affected=0) và bị bỏ qua,
  // không đè lên kết quả user vừa xử lý.
  private async expireOne(
    checkpoint: Pick<
      CheckpointResponseDto,
      'id' | 'replyMessageId' | 'userId' | 'channelId' | 'channelType'
    >,
  ): Promise<void> {
    const { claimed } = await this.checkpoint.claim({
      id: checkpoint.id,
      toStatus: OrchestrationCheckpointStatus.REJECTED,
    });
    if (!claimed) return;

    await this.messageClient.updateMessage({
      id: checkpoint.replyMessageId,
      userId: checkpoint.userId,
      content: '⏱️ Yêu cầu duyệt đã hết hạn, tự động huỷ.',
    });
    await this.agentStream.emitStep(
      {
        userId: checkpoint.userId,
        channelId: checkpoint.channelId,
        messageId: checkpoint.replyMessageId,
        channelType: checkpoint.channelType,
      },
      { type: EAgentStreamStepType.DONE },
    );
  }

  // Dùng markStalledAsRejected() thay claim() vì claim() chỉ hoạt động
  // WHERE status=PENDING — stalled checkpoint đã ở status=APPROVED.
  private async recoverOne(
    checkpoint: Pick<
      CheckpointResponseDto,
      | 'id'
      | 'replyMessageId'
      | 'userId'
      | 'channelId'
      | 'channelType'
      | 'toolExecutedAt'
    >,
  ): Promise<void> {
    const { claimed } = await this.checkpoint.markStalledAsRejected({
      id: checkpoint.id,
    });
    if (!claimed) {
      this.logger.log(
        `recoverOne() checkpoint ${checkpoint.id} was already resolved — skipping`,
      );
      return;
    }

    this.logger.warn(
      `recoverOne() checkpoint ${checkpoint.id} marked REJECTED after stalled execution — notifying user`,
    );

    // toolExecutedAt đã set = hành động THẬT đã chạy xong, worker chỉ crash
    // lúc tổng hợp câu trả lời sau đó — báo "thử lại" ở đây sẽ ghi trùng.
    //
    // toolExecutedAt CHƯA set thì KHÔNG có nghĩa là chưa chạy — approveCheckpoint()
    // gọi tool thật RỒI MỚI markToolExecuted(), nên worker crash đúng giữa 2 bước đó
    // vẫn để lại toolExecutedAt=null dù hành động (không idempotent) đã chạy xong.
    // Không thể phân biệt 2 case này chỉ bằng dữ liệu đang có — báo "thử lại" một cách
    // chắc nịch ở đây là nguy hiểm (có thể khiến hành động chạy trùng lần 2).
    const content = checkpoint.toolExecutedAt
      ? WORKER_CRASHED_AFTER_EXECUTION_MESSAGE
      : WORKER_CRASHED_EXECUTION_UNKNOWN_MESSAGE;
    await this.messageClient.updateMessage({
      id: checkpoint.replyMessageId,
      userId: checkpoint.userId,
      content,
    });
    await this.agentStream.emitStep(
      {
        userId: checkpoint.userId,
        channelId: checkpoint.channelId,
        messageId: checkpoint.replyMessageId,
        channelType: checkpoint.channelType,
      },
      { type: EAgentStreamStepType.DONE },
    );
  }
}
