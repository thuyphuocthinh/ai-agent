import { randomUUID } from 'crypto';
import { Injectable } from '@nestjs/common';

export interface ChatSession {
  id: string;
  userId: string;
  conversationId: string;
  tenantId: string;
  botUserId: string;
  approvalMessageIds: Set<string>;
}

/**
 * Quản lý vòng đời và lưu trữ phiên hội thoại (In-Memory Session Storage).
 */
@Injectable()
export class ChatSessionManager {
  private readonly sessions = new Map<string, ChatSession>();

  get(sessionId: string): ChatSession | undefined {
    return this.sessions.get(sessionId);
  }

  getOrCreate(sessionId?: string): ChatSession {
    if (sessionId) {
      const existing = this.sessions.get(sessionId);
      if (existing) return existing;
    }
    const session: ChatSession = {
      id: sessionId || randomUUID(),
      userId: randomUUID(),
      conversationId: randomUUID(),
      tenantId: randomUUID(),
      botUserId: randomUUID(),
      approvalMessageIds: new Set<string>(),
    };
    this.sessions.set(session.id, session);
    return session;
  }

  trackApproval(sessionId: string, messageId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.approvalMessageIds.add(messageId);
    }
  }

  hasApproval(sessionId: string, messageId: string): boolean {
    const session = this.sessions.get(sessionId);
    return !!session?.approvalMessageIds.has(messageId);
  }
}
