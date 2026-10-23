export const CHAT_SESSION_MANAGER = Symbol('CHAT_SESSION_MANAGER');

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
  createdAt?: Date;
  lastSeenAt?: Date;
}

/** Alias tương thích ngược */
export type ChatSession = IChatSession;

/**
 * Port trừu tượng quản lý phiên làm việc hội thoại.
 * Hỗ trợ cả triển khai in-memory lẫn cơ sở dữ liệu bất đồng bộ (PostgreSQL, Redis, MongoDB).
 */
export interface IChatSessionManager {
  get(sessionId: string): Promise<IChatSession | undefined> | IChatSession | undefined;
  getOrCreate(sessionId?: string): Promise<IChatSession> | IChatSession;
  trackApproval(sessionId: string, messageId: string): Promise<void> | void;
  hasApproval(sessionId: string, messageId: string): Promise<boolean> | boolean;
}
