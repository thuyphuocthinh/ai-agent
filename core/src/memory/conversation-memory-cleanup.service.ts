import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ORCHESTRATION_CONSTANTS } from '@agent/core/constants';
import { ConversationMemoryService } from './conversation-memory.service';

// conversation_memory chỉ là gợi ý tham khảo, không phải nguồn sự thật lâu dài —
// tự xoá sau CHANNEL_MEMORY_TTL_HOURS, cùng pattern @Cron với CheckpointCleanupService.
@Injectable()
export class ConversationMemoryCleanupService {
  private readonly logger = new Logger(ConversationMemoryCleanupService.name);

  constructor(private readonly memoryService: ConversationMemoryService) {}

  @Cron(CronExpression.EVERY_HOUR, { name: 'expire-conversation-memory' })
  async expireOldMemories(): Promise<void> {
    const deleted = await this.memoryService.deleteExpired(
      ORCHESTRATION_CONSTANTS.CHANNEL_MEMORY_TTL_HOURS,
    );
    if (deleted === 0) return;

    this.logger.log(`expireOldMemories() deleted ${deleted} expired row(s)`);
  }
}

// Backward compatibility alias
export { ConversationMemoryCleanupService as ChannelMemoryCleanupService };
