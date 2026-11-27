import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import {
  COMPACTION_SYSTEM_PROMPT,
  ORCHESTRATION_CONSTANTS,
  buildIncrementalCompactionPrompt,
} from '@agent/core/constants';
import {
  editTurnForContext,
  formatTurnRoleLabel,
  trimTurnsToCharBudget,
} from '../../../common/text/context-edit.util';
import { resolveHistoryCharBudget } from '../../../common/text/token-budget.util';
import {
  CONVERSATION_COMPACTION_REPOSITORY,
  EffectiveConversationContext,
  IConversationCompactionRepository,
} from '../../../contracts/memory/conversation-compaction.interface';
import { LlmStrategyFactory } from '../../strategy/llm-strategy.factory';
import { resolveSupervisorModelId } from '../../supervisor/utils/supervisor-model.util';

@Injectable()
export class ConversationCompactionService {
  private readonly logger = new Logger(ConversationCompactionService.name);
  private readonly inFlight = new Set<string>();

  constructor(
    @Optional()
    @Inject(CONVERSATION_COMPACTION_REPOSITORY)
    private readonly repository?: IConversationCompactionRepository,
    @Optional()
    private readonly llmFactory?: LlmStrategyFactory,
  ) {}

  async loadEffectiveContext(
    conversationId: string,
    modelId = '',
  ): Promise<EffectiveConversationContext> {
    if (!this.repository) {
      return { recentTurns: [] };
    }
    const state = await this.repository.getCompactionState(conversationId);
    const messages = await this.repository.getMessagesInWindow({
      conversationId,
      afterMessageId: state?.summarizedUntilMessageId,
      limit: ORCHESTRATION_CONSTANTS.COMPACTION_FETCH_CAP,
    });
    const recentTurns = trimTurnsToCharBudget(
      messages.slice(-ORCHESTRATION_CONSTANTS.CHAT_HISTORY_LIMIT),
      resolveHistoryCharBudget(modelId),
    );
    return {
      summary: state?.summary,
      recentTurns,
    };
  }

  scheduleCompaction(conversationId: string, modelId = ''): void {
    if (!conversationId || this.inFlight.has(conversationId)) return;
    void this.compactConversation(conversationId, modelId).catch((err) => {
      this.logger.warn(
        `Background compaction failed for ${conversationId}: ${err instanceof Error ? err.message : String(err)}`,
      );
    });
  }

  async compactConversation(
    conversationId: string,
    modelId = '',
  ): Promise<void> {
    if (!this.repository || !this.llmFactory || this.inFlight.has(conversationId)) {
      return;
    }
    this.inFlight.add(conversationId);
    try {
      const state = await this.repository.getCompactionState(conversationId);
      const pending = await this.repository.getMessagesInWindow({
        conversationId,
        afterMessageId: state?.summarizedUntilMessageId,
        limit: ORCHESTRATION_CONSTANTS.COMPACTION_FETCH_CAP,
      });
      if (pending.length <= ORCHESTRATION_CONSTANTS.COMPACTION_TRIGGER_TURNS) {
        return;
      }

      const cutIndex =
        pending.length - ORCHESTRATION_CONSTANTS.COMPACTION_KEEP_RECENT_TURNS;
      const toCompact = pending.slice(0, cutIndex);
      if (toCompact.length === 0) return;

      const transcript = toCompact
        .map((m) => {
          const edited = editTurnForContext(m);
          return `${formatTurnRoleLabel(edited.role)}: ${edited.text}`;
        })
        .join('\n\n');

      const targetModel = modelId.trim() || resolveSupervisorModelId('plan');
      const { strategy, model } = this.llmFactory.resolve(targetModel);
      const session = strategy.startChat({
        model,
        systemInstruction: COMPACTION_SYSTEM_PROMPT,
        tools: [],
        history: [],
        temperature: ORCHESTRATION_CONSTANTS.COMPACTION_LLM_TEMPERATURE,
      });
      const result = await session.sendMessage(
        buildIncrementalCompactionPrompt(state?.summary, transcript),
      );
      const summary = result.text.trim();

      if (!summary) return;
      await this.repository.saveCompactionState(conversationId, {
        summary,
        summarizedUntilMessageId: toCompact[toCompact.length - 1].id,
        updatedAt: new Date().toISOString(),
      });
    } finally {
      this.inFlight.delete(conversationId);
    }
  }
}
