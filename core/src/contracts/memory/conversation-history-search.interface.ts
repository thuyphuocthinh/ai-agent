import { EMessageRole } from '@agent/core/constants';

export const CONVERSATION_HISTORY_SEARCH_REPOSITORY = Symbol.for(
  'CONVERSATION_HISTORY_SEARCH_REPOSITORY',
);

export type ConversationHistorySearchMode = 'search' | 'around';

export interface SearchConversationHistoryParams {
  readonly conversationId: string;
  readonly query?: string;
  readonly role?: EMessageRole;
  readonly fromDate?: Date;
  readonly toDate?: Date;
  readonly aroundMessageId?: string;
  readonly contextWindow?: number;
  readonly limit: number;
  readonly offset: number;
}

export interface ConversationHistoryMatchDto {
  readonly messageId: string;
  readonly role: EMessageRole;
  readonly createdAt: string;
  readonly text: string;
  readonly truncated: boolean;
}

export interface ConversationHistorySearchResult {
  readonly mode: ConversationHistorySearchMode;
  readonly totalMatches: number;
  readonly items: ConversationHistoryMatchDto[];
}

/**
 * Port truy vấn lịch sử tin nhắn đã lưu trong PostgreSQL theo từng conversation.
 */
export interface IConversationHistorySearchRepository {
  search(
    params: SearchConversationHistoryParams,
  ): Promise<ConversationHistorySearchResult>;
}
