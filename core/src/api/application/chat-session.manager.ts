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
@Injectable()
export class InMemoryChatSessionManager implements IChatSessionManager {
  private readonly sessions = new Map<string, IChatSession>();

  get(sessionId: string): IChatSession | undefined {
    return this.sessions.get(sessionId);
  }

  getOrCreate(sessionId?: string): IChatSession {
    if (sessionId) {
      const existing = this.sessions.get(sessionId);
      if (existing) return existing;
    }
    const session: IChatSession = {
      id: sessionId || randomUUID(),
      userId: randomUUID(),
      conversationId: randomUUID(),
      tenantId: randomUUID(),
      botUserId: randomUUID(),
      approvalMessageIds: new Set<string>(),
      state: EConversationState.AI_ACTIVE,
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
}

/**
 * Alias tương thích ngược cho các module và bài test hiện hữu.
 */
@Injectable()
export class ChatSessionManager extends InMemoryChatSessionManager {}
