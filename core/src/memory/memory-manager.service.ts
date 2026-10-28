import { Injectable } from '@nestjs/common';
import {
  resolveDataCharBudget,
  resolveHistoryCharBudget,
  resolveMemoryCharBudget,
} from '../common/token-budget.util';
import { ConversationMemoryRecord as ConversationMemoryEntity } from './memory.interface';
import { ConversationMemoryService } from './conversation-memory.service';
import { ContextBudget } from './memory.interface';

// Single entry point for the 3 char budgets a model call splits its context
// window into, so callers can't end up combining a budget computed for one
// model with data meant for another.
@Injectable()
export class MemoryManagerService {
  constructor(private readonly memoryService: ConversationMemoryService) {}

  buildBudget(modelId: string): ContextBudget {
    return {
      toolResultCharBudget: resolveDataCharBudget(modelId),
      memoryCharBudget: resolveMemoryCharBudget(modelId),
      historyCharBudget: resolveHistoryCharBudget(modelId),
    };
  }

  async getMemories(
    conversationId: string,
    modelId: string,
    queryText?: string,
  ): Promise<ConversationMemoryEntity[]> {
    return this.memoryService.getRecentMemories(
      conversationId,
      resolveMemoryCharBudget(modelId),
      queryText,
    );
  }

  async recordUserDeclaredFact(
    conversationId: string,
    sourceMessageId: string,
    fact: string,
  ): Promise<void> {
    return this.memoryService.recordUserDeclaredFact(
      conversationId,
      sourceMessageId,
      fact,
    );
  }
}
