export const CHAT_SESSION_MANAGER = Symbol('CHAT_SESSION_MANAGER');

export enum EConversationState {
  AI_ACTIVE = 'AI_ACTIVE',
  HUMAN_TAKEOVER = 'HUMAN_TAKEOVER',
  RESOLVED = 'RESOLVED',
}

/**
 * Phiên làm việc hội thoại của người dùng (Chat Session).
 */
export interface IChatSession {
  id: string;
  userId: string;
  conversationId: string;
  tenantId: string;
  botUserId: string;
  approvalMessageIds: Set<string>;
  state?: EConversationState;
  title?: string;
  createdAt?: Date;
  lastSeenAt?: Date;
}

/** Alias tương thích ngược */
export type ChatSession = IChatSession;

export interface IConversationSummary {
  id: string;
  title: string;
  state: EConversationState;
  lastSeenAt: Date;
  createdAt: Date;
}

/**
 * Port trừu tượng quản lý phiên làm việc hội thoại.
 * Hỗ trợ cả triển khai in-memory lẫn cơ sở dữ liệu bất đồng bộ (PostgreSQL, Redis, MongoDB).
 */
export interface IChatSessionManager {
  get(sessionId: string): Promise<IChatSession | undefined> | IChatSession | undefined;
  getOrCreate(sessionId?: string): Promise<IChatSession> | IChatSession;
  trackApproval(sessionId: string, messageId: string): Promise<void> | void;
  hasApproval(sessionId: string, messageId: string): Promise<boolean> | boolean;
  setConversationState?(sessionId: string, state: EConversationState): Promise<void> | void;
  getConversationState?(sessionId: string): Promise<EConversationState> | EConversationState;
  listRecent?(options?: { cursor?: string; limit?: number }): Promise<{
    data: IConversationSummary[];
    meta: { limit: number; nextCursor?: string; hasMore: boolean };
  }>;
  updateTitle?(sessionId: string, title: string): Promise<void>;
}
