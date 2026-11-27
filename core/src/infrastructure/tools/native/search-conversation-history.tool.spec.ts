import {
  EMessageRole,
  HISTORY_SEARCH_ERROR_CODES,
  ORCHESTRATION_CONSTANTS,
} from '@agent/core/constants';
import { MAX_TOOL_RESULT_CHARS } from '../../../common/text/token-budget.util';
import { IConversationHistorySearchRepository } from '../../../contracts/memory/conversation-history-search.interface';
import { SearchConversationHistoryTool } from './search-conversation-history.tool';

describe('SearchConversationHistoryTool', () => {
  const mockRepo: jest.Mocked<IConversationHistorySearchRepository> = {
    search: jest.fn(),
  };

  let tool: SearchConversationHistoryTool;

  beforeEach(() => {
    jest.clearAllMocks();
    tool = new SearchConversationHistoryTool(mockRepo);
  });

  it('returns MISSING_CONVERSATION when context.conversationId is missing', async () => {
    const res = await tool.execute({ query: 'ORD-8899' }, {});

    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain(
      HISTORY_SEARCH_ERROR_CODES.MISSING_CONVERSATION,
    );
    expect(mockRepo.search).not.toHaveBeenCalled();
  });

  it('ignores any spoofed args.conversationId and enforces context.conversationId', async () => {
    mockRepo.search.mockResolvedValueOnce({
      mode: 'search',
      totalMatches: 1,
      items: [
        {
          messageId: 'm1',
          role: EMessageRole.USER,
          createdAt: '2026-11-27T10:00:00.000Z',
          text: 'Mã VIP-9910',
          truncated: false,
        },
      ],
    });

    const res = await tool.execute(
      { conversationId: 'conv-other-tenant', query: 'VIP-9910', role: 'USER' },
      { conversationId: 'conv-active' },
    );

    expect(res.isError).toBe(false);
    expect(mockRepo.search).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: 'conv-active',
        query: 'VIP-9910',
        role: EMessageRole.USER,
        limit: ORCHESTRATION_CONSTANTS.HISTORY_SEARCH_DEFAULT_LIMIT,
      }),
    );
  });

  it('rejects empty filter arguments or invalid ISO date ranges', async () => {
    const emptyRes = await tool.execute({}, { conversationId: 'conv-1' });
    expect(emptyRes.isError).toBe(true);
    expect(emptyRes.content[0].text).toContain(
      HISTORY_SEARCH_ERROR_CODES.INVALID_ARGUMENTS,
    );

    const badDateRes = await tool.execute(
      { fromDate: 'not-a-date' },
      { conversationId: 'conv-1' },
    );
    expect(badDateRes.isError).toBe(true);
    expect(badDateRes.content[0].text).toContain(
      HISTORY_SEARCH_ERROR_CODES.INVALID_ARGUMENTS,
    );

    const reversedDateRes = await tool.execute(
      {
        fromDate: '2026-11-28T00:00:00Z',
        toDate: '2026-11-27T00:00:00Z',
      },
      { conversationId: 'conv-1' },
    );
    expect(reversedDateRes.isError).toBe(true);
    expect(reversedDateRes.content[0].text).toContain(
      HISTORY_SEARCH_ERROR_CODES.INVALID_ARGUMENTS,
    );
  });

  it('returns MESSAGE_NOT_FOUND when aroundMessageId returns empty results', async () => {
    mockRepo.search.mockResolvedValueOnce({
      mode: 'around',
      totalMatches: 0,
      items: [],
    });

    const res = await tool.execute(
      { aroundMessageId: 'missing-id', contextWindow: 99 },
      { conversationId: 'conv-1' },
    );

    expect(mockRepo.search).toHaveBeenCalledWith(
      expect.objectContaining({
        contextWindow: ORCHESTRATION_CONSTANTS.HISTORY_SEARCH_CONTEXT_WINDOW_MAX,
      }),
    );
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain(HISTORY_SEARCH_ERROR_CODES.NOT_FOUND);
  });

  it('clamps limit and truncates returned items list to stay within MAX_TOOL_RESULT_CHARS', async () => {
    const hugeItems = Array.from({ length: 20 }, (_, i) => ({
      messageId: `msg-${i}`,
      role: EMessageRole.MODEL,
      createdAt: '2026-11-27T10:00:00.000Z',
      text: 'Z'.repeat(600),
      truncated: true,
    }));
    mockRepo.search.mockResolvedValueOnce({
      mode: 'search',
      totalMatches: 25,
      items: hugeItems,
    });

    const res = await tool.execute(
      { query: 'Z', limit: 999 },
      { conversationId: 'conv-1' },
    );

    expect(mockRepo.search).toHaveBeenCalledWith(
      expect.objectContaining({
        limit: ORCHESTRATION_CONSTANTS.HISTORY_SEARCH_MAX_LIMIT,
      }),
    );
    expect(res.isError).toBe(false);
    const rawJson = res.content[0].text ?? '';
    expect(rawJson.length).toBeLessThanOrEqual(MAX_TOOL_RESULT_CHARS);
    const parsed = JSON.parse(rawJson);
    expect(parsed.hasMore).toBe(true);
    expect(parsed.returnedCount).toBeLessThan(20);
  });

  it('falls back to cross-role search when strict role filter yields 0 matches but opposite role matches', async () => {
    mockRepo.search
      .mockResolvedValueOnce({
        mode: 'search',
        totalMatches: 0,
        items: [],
      })
      .mockResolvedValueOnce({
        mode: 'search',
        totalMatches: 1,
        items: [
          {
            messageId: 'm-user-4',
            role: EMessageRole.USER,
            createdAt: '2026-11-27T01:00:00.000Z',
            text: 'Người phê duyệt là chị Minh Anh.',
            truncated: false,
          },
        ],
      });

    const res = await tool.execute(
      { query: 'Minh Anh', role: 'ASSISTANT' },
      { conversationId: 'conv-1' },
    );

    expect(mockRepo.search).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ role: EMessageRole.MODEL }),
    );
    expect(mockRepo.search).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ role: undefined }),
    );
    expect(res.isError).toBe(false);
    const parsed = JSON.parse(res.content[0].text ?? '{}');
    expect(parsed.roleFallbackUsed).toBe(true);
    expect(parsed.items[0].messageId).toBe('m-user-4');
  });
});
