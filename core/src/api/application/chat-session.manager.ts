import { randomUUID } from 'crypto';
import { Injectable } from '@nestjs/common';
import {
  IChatSession,
  IChatSessionManager,
  EConversationState,
} from '../../contracts';

/**
 * Quản lý phiên hội thoại trong bộ nhớ RAM (In-Memory Session Storage).
 * Phục vụ chạy cục bộ / Web Playground / Unit Tests (Zero-config).
 * Cài đặt IChatSessionManager, sẵn sàng để thay thế bằng DbChatSessionManager.
 */
export const DEFAULT_SESSION_TENANT_ID = 'default';

@Injectable()
export class InMemoryChatSessionManager implements IChatSessionManager {
  private readonly sessions = new Map<string, IChatSession>();

  get(sessionId: string): IChatSession | undefined {
    return this.sessions.get(sessionId);
  }

  getOrCreate(sessionId?: string, tenantId?: string): IChatSession {
    if (sessionId) {
      const existing = this.sessions.get(sessionId);
      if (existing) return existing;
    }
    const session: IChatSession = {
      id: sessionId || randomUUID(),
      userId: randomUUID(),
      conversationId: randomUUID(),
      tenantId: tenantId || randomUUID(),
      botUserId: randomUUID(),
      approvalMessageIds: new Set<string>(),
      state: EConversationState.AI_ACTIVE,
      channelType: 'web',
      sessionType: 'web',
      createdAt: new Date(),
      lastSeenAt: new Date(),
    };
    this.sessions.set(session.id, session);
    return session;
  }

  trackApproval(sessionId: string, messageId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.approvalMessageIds.add(messageId);
      session.lastSeenAt = new Date();
    }
  }

  hasApproval(sessionId: string, messageId: string): boolean {
    const session = this.sessions.get(sessionId);
    return !!session?.approvalMessageIds.has(messageId);
  }

  setConversationState(sessionId: string, state: EConversationState): void {
    const session = this.getOrCreate(sessionId);
    session.state = state;
    session.lastSeenAt = new Date();
  }

  getConversationState(sessionId: string): EConversationState {
    const session = this.sessions.get(sessionId);
    if (session && session.state) {
      return session.state;
    }
    return EConversationState.AI_ACTIVE;
  }

  listRecent(options?: { cursor?: string; limit?: number }) {
    const list = Array.from(this.sessions.values())
      .sort((a, b) => (b.lastSeenAt?.getTime() ?? 0) - (a.lastSeenAt?.getTime() ?? 0))
      .slice(0, options?.limit ?? 30)
      .map((s) => ({
        id: s.id,
        title: s.title || 'Cuộc trò chuyện mới',
        state: s.state || EConversationState.AI_ACTIVE,
        lastSeenAt: s.lastSeenAt || new Date(),
        createdAt: s.createdAt || new Date(),
      }));
    return Promise.resolve({
      data: list,
      meta: { limit: options?.limit ?? 30, hasMore: false },
    });
  }

  updateTitle(sessionId: string, title: string) {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.title = title.trim();
    }
    return Promise.resolve();
  }
}

/**
 * Alias tương thích ngược cho các module và bài test hiện hữu.
 */
@Injectable()
export class ChatSessionManager extends InMemoryChatSessionManager {}
