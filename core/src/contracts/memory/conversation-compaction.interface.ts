import { ChatHistoryTurnDto } from '../dtos/message-client.dto';

export const CONVERSATION_COMPACTION_REPOSITORY = Symbol.for(
  'CONVERSATION_COMPACTION_REPOSITORY',
);

export interface ConversationCompactionState {
  readonly summary: string;
  readonly summarizedUntilMessageId: string;
  readonly updatedAt: string;
}

export interface CompactionMessageRecord extends ChatHistoryTurnDto {
  readonly id: string;
}

export interface EffectiveConversationContext {
  readonly summary?: string;
  readonly recentTurns: ChatHistoryTurnDto[];
}

/**
 * Port lưu trữ trạng thái nén lịch sử theo từng conversation.
 */
export interface IConversationCompactionRepository {
  getCompactionState(
    conversationId: string,
  ): Promise<ConversationCompactionState | null>;

  saveCompactionState(
    conversationId: string,
    state: ConversationCompactionState,
  ): Promise<void>;

  getMessagesInWindow(params: {
    conversationId: string;
    afterMessageId?: string;
    beforeMessageId?: string;
    limit: number;
  }): Promise<CompactionMessageRecord[]>;
}
