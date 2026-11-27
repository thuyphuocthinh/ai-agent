import { EMessageRole } from '@agent/core/constants';
import { MessageRole } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { PrismaConversationCompactionRepository } from './prisma-conversation-compaction.repository';

describe('PrismaConversationCompactionRepository', () => {
  const mockPrisma = {
    conversation: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    conversationMessage: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
    },
  };

  let repo: PrismaConversationCompactionRepository;

  beforeEach(() => {
    jest.clearAllMocks();
    repo = new PrismaConversationCompactionRepository(
      mockPrisma as unknown as PrismaService,
    );
  });

  describe('getCompactionState', () => {
    it('returns parsed compaction state when valid', async () => {
      mockPrisma.conversation.findUnique.mockResolvedValueOnce({
        metadata: {
          compaction: {
            summary: 'Tóm tắt mẫu',
            summarizedUntilMessageId: 'msg-10',
            updatedAt: '2026-11-27T00:00:00.000Z',
          },
        },
      });

      const state = await repo.getCompactionState('conv-1');
      expect(state).toEqual({
        summary: 'Tóm tắt mẫu',
        summarizedUntilMessageId: 'msg-10',
        updatedAt: '2026-11-27T00:00:00.000Z',
      });
    });

    it('returns null when compaction metadata is missing or malformed', async () => {
      mockPrisma.conversation.findUnique.mockResolvedValueOnce({
        metadata: { compaction: { summary: 123 } },
      });

      expect(await repo.getCompactionState('conv-1')).toBeNull();
    });
  });

  describe('saveCompactionState', () => {
    it('preserves existing conversation metadata keys when updating compaction', async () => {
      mockPrisma.conversation.findUnique.mockResolvedValueOnce({
        metadata: { theme: 'dark', pinned: true },
      });
      mockPrisma.conversation.update.mockResolvedValueOnce({});

      const state = {
        summary: 'Tóm tắt mới',
        summarizedUntilMessageId: 'msg-20',
        updatedAt: '2026-11-27T01:00:00.000Z',
      };
      await repo.saveCompactionState('conv-1', state);

      expect(mockPrisma.conversation.update).toHaveBeenCalledWith({
        where: { id: 'conv-1' },
        data: {
          metadata: {
            theme: 'dark',
            pinned: true,
            compaction: state,
          },
        },
      });
    });
  });

  describe('getMessagesInWindow', () => {
    it('resolves cursor timestamps, restores chronological order, filters banners and maps roles', async () => {
      const cursorDate = new Date('2026-11-27T00:00:00.000Z');
      const t1 = new Date('2026-11-27T00:01:00.000Z');
      const t2 = new Date('2026-11-27T00:02:00.000Z');
      const t3 = new Date('2026-11-27T00:03:00.000Z');

      mockPrisma.conversationMessage.findUnique.mockResolvedValueOnce({
        createdAt: cursorDate,
      });
      mockPrisma.conversationMessage.findMany.mockResolvedValueOnce([
        { id: 'm3', role: MessageRole.ASSISTANT, text: 'AI đáp', metadata: null, createdAt: t3 },
        { id: 'm2', role: MessageRole.ASSISTANT, text: '⏸️ Cần bạn duyệt hành động', metadata: {}, createdAt: t2 },
        { id: 'm1', role: MessageRole.USER, text: 'User hỏi', metadata: { k: 1 }, createdAt: t1 },
      ]);

      const records = await repo.getMessagesInWindow({
        conversationId: 'conv-1',
        afterMessageId: 'm0',
        limit: 50,
      });

      expect(mockPrisma.conversationMessage.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            conversationId: 'conv-1',
            createdAt: { gt: cursorDate },
          },
          orderBy: { createdAt: 'desc' },
          take: 50,
        }),
      );
      expect(records).toEqual([
        {
          id: 'm1',
          role: EMessageRole.USER,
          text: 'User hỏi',
          metadata: { k: 1 },
          createdAt: t1,
        },
        {
          id: 'm3',
          role: EMessageRole.MODEL,
          text: 'AI đáp',
          metadata: undefined,
          createdAt: t3,
        },
      ]);
    });
  });
});
