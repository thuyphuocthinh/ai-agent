import { EMessageRole, ORCHESTRATION_CONSTANTS } from '@agent/core/constants';
import { MessageRole } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { PrismaConversationHistorySearchRepository } from './prisma-conversation-history-search.repository';

describe('PrismaConversationHistorySearchRepository', () => {
  const mockPrisma = {
    conversationMessage: {
      count: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
    },
  };

  let repo: PrismaConversationHistorySearchRepository;

  beforeEach(() => {
    jest.clearAllMocks();
    repo = new PrismaConversationHistorySearchRepository(
      mockPrisma as unknown as PrismaService,
    );
  });

  describe('searchByFilters', () => {
    it('scopes strictly to conversationId, builds case-insensitive AND keyword filters, excludes HITL banners, and extracts keyword snippets', async () => {
      const longAnswer = `${'X'.repeat(900)} thông tin mật mã CABINET-Z91 ở giữa câu ${'Y'.repeat(900)}`;
      const t1 = new Date('2026-11-27T10:00:00.000Z');
      const t2 = new Date('2026-11-27T09:00:00.000Z');

      mockPrisma.conversationMessage.count.mockResolvedValueOnce(2);
      mockPrisma.conversationMessage.findMany.mockResolvedValueOnce([
        {
          id: 'msg-pause',
          role: MessageRole.ASSISTANT,
          text: '⏸️ Cần bạn duyệt CABINET-Z91',
          createdAt: t1,
        },
        {
          id: 'msg-hit',
          role: MessageRole.ASSISTANT,
          text: longAnswer,
          createdAt: t2,
        },
      ]);

      const fromDate = new Date('2026-11-27T00:00:00.000Z');
      const toDate = new Date('2026-11-27T23:59:59.000Z');
      const res = await repo.search({
        conversationId: 'conv-1',
        query: 'CABINET-Z91 giữa',
        role: EMessageRole.MODEL,
        fromDate,
        toDate,
        limit: 5,
        offset: 0,
      });

      expect(mockPrisma.conversationMessage.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            conversationId: 'conv-1',
            isText: true,
            role: MessageRole.ASSISTANT,
            createdAt: { gte: fromDate, lte: toDate },
            AND: [
              { text: { contains: 'CABINET-Z91', mode: 'insensitive' } },
              { text: { contains: 'giữa', mode: 'insensitive' } },
            ],
          },
          skip: 0,
          take: 10,
        }),
      );
      expect(res.mode).toBe('search');
      expect(res.totalMatches).toBe(2);
      expect(res.items).toHaveLength(1);
      expect(res.items[0]).toEqual({
        messageId: 'msg-hit',
        role: EMessageRole.MODEL,
        createdAt: t2.toISOString(),
        text: expect.stringContaining('CABINET-Z91'),
        truncated: true,
      });
      expect(res.items[0].text.length).toBeLessThanOrEqual(
        ORCHESTRATION_CONSTANTS.HISTORY_SEARCH_SNIPPET_CHARS + 6,
      );
    });

    it('falls back to ranked OR retrieval when strict AND finds 0 matches on verbose descriptive queries', async () => {
      mockPrisma.conversationMessage.count.mockResolvedValueOnce(0);
      mockPrisma.conversationMessage.findMany
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([
          {
            id: 'msg-weak',
            role: MessageRole.USER,
            text: 'Người giao hàng ca sáng đã đi rồi.',
            createdAt: new Date('2026-11-27T09:00:00.000Z'),
          },
          {
            id: 'msg-best',
            role: MessageRole.USER,
            text: 'Bổ sung quy tắc: người phụ trách phê duyệt cuối cùng là chị Minh Anh.',
            createdAt: new Date('2026-11-27T01:00:00.000Z'),
          },
        ]);

      const res = await repo.search({
        conversationId: 'conv-1',
        query: 'họ tên người phê duyệt cuối',
        limit: 5,
        offset: 0,
      });

      expect(res.totalMatches).toBe(1);
      expect(res.items).toHaveLength(1);
      expect(res.items[0].messageId).toBe('msg-best');
      expect(res.items[0].text).toContain('Minh Anh');
    });
  });

  describe('searchAroundMessage', () => {
    it('returns empty items when aroundMessageId does not exist in active conversationId', async () => {
      mockPrisma.conversationMessage.findFirst.mockResolvedValueOnce(null);

      const res = await repo.search({
        conversationId: 'conv-1',
        aroundMessageId: 'foreign-msg',
        contextWindow: 2,
        limit: 8,
        offset: 0,
      });

      expect(res).toEqual({ mode: 'around', totalMatches: 0, items: [] });
      expect(mockPrisma.conversationMessage.findMany).not.toHaveBeenCalled();
    });

    it('merges adjacent messages chronologically around target messageId and filters HITL banners', async () => {
      const t1 = new Date('2026-11-27T01:00:00.000Z');
      const t2 = new Date('2026-11-27T02:00:00.000Z');
      const t3 = new Date('2026-11-27T03:00:00.000Z');

      mockPrisma.conversationMessage.findFirst.mockResolvedValueOnce({
        id: 'm2',
        role: MessageRole.ASSISTANT,
        text: 'Đáp án chứa mã CABINET-Z91',
        createdAt: t2,
      });
      mockPrisma.conversationMessage.findMany
        .mockResolvedValueOnce([
          { id: 'm2', role: MessageRole.ASSISTANT, text: 'Đáp án chứa mã CABINET-Z91', createdAt: t2 },
          { id: 'm1', role: MessageRole.USER, text: 'Lượt hỏi cũ', createdAt: t1 },
        ])
        .mockResolvedValueOnce([
          { id: 'm2', role: MessageRole.ASSISTANT, text: 'Đáp án chứa mã CABINET-Z91', createdAt: t2 },
          { id: 'm-skip', role: MessageRole.ASSISTANT, text: '⏸️ Cần bạn làm rõ gì đó', createdAt: t2 },
          { id: 'm3', role: MessageRole.USER, text: 'Lượt nối tiếp', createdAt: t3 },
        ]);

      const res = await repo.search({
        conversationId: 'conv-1',
        aroundMessageId: 'm2',
        contextWindow: 1,
        limit: 8,
        offset: 0,
      });

      expect(res.mode).toBe('around');
      expect(res.items.map((i) => i.messageId)).toEqual(['m1', 'm2', 'm3']);
      expect(res.items[0].role).toBe(EMessageRole.USER);
      expect(res.items[1].role).toBe(EMessageRole.MODEL);
    });
  });

  it('sanitizes Prisma failures before rethrowing', async () => {
    mockPrisma.conversationMessage.count.mockRejectedValueOnce(
      new Error('SELECT * FROM conversation_messages WHERE ...'),
    );

    await expect(
      repo.search({
        conversationId: 'conv-1',
        query: 'test',
        limit: 5,
        offset: 0,
      }),
    ).rejects.toThrow();
  });
});
