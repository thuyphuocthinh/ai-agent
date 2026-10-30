import {
  InMemoryChatSessionManager,
  ChatSessionManager,
} from './chat-session.manager';
import { IChatSessionManager, IChatSession } from '../../contracts';

describe('InMemoryChatSessionManager', () => {
  let manager: InMemoryChatSessionManager;

  beforeEach(() => {
    manager = new InMemoryChatSessionManager();
  });

  describe('getOrCreate', () => {
    it('creates a new session with generated UUIDs when called without sessionId', () => {
      const session = manager.getOrCreate();

      expect(session).toBeDefined();
      expect(session.id).toBeDefined();
      expect(session.userId).toBeDefined();
      expect(session.conversationId).toBeDefined();
      expect(session.tenantId).toBeDefined();
      expect(session.botUserId).toBeDefined();
      expect(session.approvalMessageIds).toBeInstanceOf(Set);
      expect(session.approvalMessageIds.size).toBe(0);
      expect(session.createdAt).toBeInstanceOf(Date);
      expect(session.lastSeenAt).toBeInstanceOf(Date);
    });

    it('creates a new session with the specified sessionId if it does not exist', () => {
      const customId = 'session-123';
      const session = manager.getOrCreate(customId);

      expect(session.id).toBe(customId);
      expect(manager.get(customId)).toBe(session);
    });

    it('creates a session with custom tenantId when provided', () => {
      const session = manager.getOrCreate('custom-sess', 'tenant-custom');
      expect(session.tenantId).toBe('tenant-custom');
    });

    it('returns the same existing session when called repeatedly with same sessionId', () => {
      const customId = 'session-existing';
      const session1 = manager.getOrCreate(customId);
      const session2 = manager.getOrCreate(customId);

      expect(session1).toBe(session2);
      expect(session2.id).toBe(customId);
    });
  });

  describe('get', () => {
    it('returns undefined when session does not exist', () => {
      expect(manager.get('non-existent')).toBeUndefined();
    });

    it('returns the stored session when it exists', () => {
      const created = manager.getOrCreate('sess-test');
      expect(manager.get('sess-test')).toBe(created);
    });
  });

  describe('trackApproval and hasApproval', () => {
    it('returns false for hasApproval when session does not exist', () => {
      expect(manager.hasApproval('unknown-session', 'msg-1')).toBe(false);
    });

    it('returns false for hasApproval when message has not been tracked', () => {
      manager.getOrCreate('sess-approval');
      expect(manager.hasApproval('sess-approval', 'msg-untracked')).toBe(false);
    });

    it('tracks approval and updates lastSeenAt', () => {
      const session = manager.getOrCreate('sess-approval');
      const initialLastSeen = session.lastSeenAt;

      // Ensure slight time shift
      jest.useFakeTimers();
      jest.advanceTimersByTime(100);

      manager.trackApproval('sess-approval', 'msg-approved-1');

      expect(manager.hasApproval('sess-approval', 'msg-approved-1')).toBe(true);
      expect(session.approvalMessageIds.has('msg-approved-1')).toBe(true);
      expect(session.lastSeenAt.getTime()).toBeGreaterThanOrEqual(initialLastSeen.getTime());

      jest.useRealTimers();
    });

    it('does nothing gracefully when trackApproval is called on non-existent session', () => {
      expect(() => {
        manager.trackApproval('non-existent', 'msg-1');
      }).not.toThrow();
    });
  });

  describe('conversation state management', () => {
    it('defaults session state to AI_ACTIVE', () => {
      const session = manager.getOrCreate('sess-state');
      expect(session.state).toBe('AI_ACTIVE');
      expect(manager.getConversationState('sess-state')).toBe('AI_ACTIVE');
    });

    it('returns AI_ACTIVE when session does not exist', () => {
      expect(manager.getConversationState('non-existent')).toBe('AI_ACTIVE');
    });

    it('updates session conversation state to HUMAN_TAKEOVER and RESOLVED', () => {
      manager.getOrCreate('sess-state-2');
      manager.setConversationState('sess-state-2', 'HUMAN_TAKEOVER');
      expect(manager.getConversationState('sess-state-2')).toBe('HUMAN_TAKEOVER');

      manager.setConversationState('sess-state-2', 'RESOLVED');
      expect(manager.getConversationState('sess-state-2')).toBe('RESOLVED');
    });

    it('creates session when setConversationState is called for non-existent session', () => {
      manager.setConversationState('sess-auto-create', 'HUMAN_TAKEOVER');
      expect(manager.getConversationState('sess-auto-create')).toBe('HUMAN_TAKEOVER');
    });
  });

  describe('ChatSessionManager alias & Pluggable Architecture', () => {
    it('ChatSessionManager inherits from InMemoryChatSessionManager', () => {
      const legacyAlias = new ChatSessionManager();
      expect(legacyAlias).toBeInstanceOf(InMemoryChatSessionManager);
      const session = legacyAlias.getOrCreate('sess-alias');
      expect(session.id).toBe('sess-alias');
    });

    it('satisfies IChatSessionManager port contract so it can be swapped with a real DB manager', async () => {
      // Simulating how a future DbChatSessionManager implements IChatSessionManager
      class SimulatedDbChatSessionManager implements IChatSessionManager {
        private db = new Map<string, IChatSession>();

        async get(sessionId: string): Promise<IChatSession | undefined> {
          return this.db.get(sessionId);
        }

        async getOrCreate(sessionId?: string): Promise<IChatSession> {
          const id = sessionId || 'db-generated-id';
          let s = this.db.get(id);
          if (!s) {
            s = {
              id,
              userId: 'u1',
              conversationId: 'c1',
              tenantId: 't1',
              botUserId: 'b1',
              approvalMessageIds: new Set<string>(),
              createdAt: new Date(),
              lastSeenAt: new Date(),
            };
            this.db.set(id, s);
          }
          return s;
        }

        async trackApproval(sessionId: string, messageId: string): Promise<void> {
          const s = this.db.get(sessionId);
          if (s) {
            s.approvalMessageIds.add(messageId);
          }
        }

        async hasApproval(sessionId: string, messageId: string): Promise<boolean> {
          const s = this.db.get(sessionId);
          return !!s?.approvalMessageIds.has(messageId);
        }
      }

      const dbManager: IChatSessionManager = new SimulatedDbChatSessionManager();
      const session = await dbManager.getOrCreate('db-sess-1');
      expect(session.id).toBe('db-sess-1');

      await dbManager.trackApproval('db-sess-1', 'msg-db-1');
      const hasApproved = await dbManager.hasApproval('db-sess-1', 'msg-db-1');
      expect(hasApproved).toBe(true);
    });
  });
});
