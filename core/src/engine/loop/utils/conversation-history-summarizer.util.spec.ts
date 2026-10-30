import { ConversationHistorySummarizer } from './conversation-history-summarizer.util';
import { EMessageRole, CACHE } from '@agent/core/constants';
import { ChatHistoryTurnDto } from '../../../contracts/dtos/message-client.dto';
import { CachedService } from '../../../infrastructure/redis/cached.service';
import { LlmStrategyFactory } from '../../strategy/llm-strategy.factory';

describe('ConversationHistorySummarizer', () => {
  let mockCachedService: jest.Mocked<CachedService>;
  let mockLlmFactory: jest.Mocked<LlmStrategyFactory>;
  let mockSession: { sendMessage: jest.Mock };

  beforeEach(() => {
    mockSession = {
      sendMessage: jest.fn().mockResolvedValue({
        text: 'Người dùng yêu cầu kiểm tra doanh thu năm 2026 và đã xác nhận bảng orders.',
      }),
    };

    mockCachedService = {
      getOrSetDetail: jest.fn((_key, _ttl, fetcher) => fetcher()),
    } as unknown as jest.Mocked<CachedService>;

    mockLlmFactory = {
      resolve: jest.fn().mockReturnValue({
        strategy: {
          startChat: jest.fn().mockReturnValue(mockSession),
        },
        model: 'gemini-1.5-flash',
      }),
    } as unknown as jest.Mocked<LlmStrategyFactory>;
  });

  it('giữ nguyên 100% lịch sử khi số lượng turns <= 10', async () => {
    const turns: ChatHistoryTurnDto[] = Array.from({ length: 8 }, (_, i) => ({
      role: i % 2 === 0 ? EMessageRole.USER : EMessageRole.MODEL,
      text: `Nội dung lượt chat ${i}`,
    }));

    const result = await ConversationHistorySummarizer.compress(
      turns,
      'conv-123',
      mockCachedService,
      mockLlmFactory,
    );

    expect(result.history).toHaveLength(8);
    expect(result.contextSummary).toBeUndefined();
    expect(mockCachedService.getOrSetDetail).not.toHaveBeenCalled();
  });

  it('tự động nén các turn cũ và giữ 6 turn gần nhất khi turns > 10', async () => {
    const turns: ChatHistoryTurnDto[] = Array.from({ length: 14 }, (_, i) => ({
      id: `turn-id-${i}`,
      role: i % 2 === 0 ? EMessageRole.USER : EMessageRole.MODEL,
      text: `Nội dung lượt chat ${i}`,
    }));

    const result = await ConversationHistorySummarizer.compress(
      turns,
      'conv-999',
      mockCachedService,
      mockLlmFactory,
    );

    // 14 turns: 8 turns cũ (0..7) được nén, 6 turns gần nhất (8..13) giữ lại.
    // Kết quả: 1 anchor user turn + 1 ack model turn + 6 recent turns = 8 turns tổng cộng.
    expect(result.history).toHaveLength(8);
    expect(result.history[0].role).toBe(EMessageRole.USER);
    expect(result.history[0].text).toContain('[TÓM TẮT BỐI CẢNH CÁC LƯỢT TRÒ CHUYỆN TRƯỚC ĐÓ]');
    expect(result.history[1].role).toBe(EMessageRole.MODEL);
    expect(result.history[2].text).toBe('Nội dung lượt chat 8');
    expect(result.history[7].text).toBe('Nội dung lượt chat 13');

    // Kiểm tra cache key chuẩn
    expect(mockCachedService.getOrSetDetail).toHaveBeenCalledWith(
      CACHE.SUMMARY.KEYS.CONVERSATION('conv-999', '8_turn-id-7'),
      CACHE.SUMMARY.SETTINGS.TTL,
      expect.any(Function),
    );
  });

  it('sử dụng bản tóm tắt từ cache nếu có sẵn mà không gọi LLM', async () => {
    const turns: ChatHistoryTurnDto[] = Array.from({ length: 12 }, (_, i) => ({
      role: i % 2 === 0 ? EMessageRole.USER : EMessageRole.MODEL,
      text: `Turn ${i}`,
    }));

    mockCachedService.getOrSetDetail.mockResolvedValueOnce('Tóm tắt từ Redis Cache');

    const result = await ConversationHistorySummarizer.compress(
      turns,
      'conv-cached',
      mockCachedService,
      mockLlmFactory,
    );

    expect(result.contextSummary).toBe('Tóm tắt từ Redis Cache');
    expect(result.history[0].text).toContain('Tóm tắt từ Redis Cache');
    expect(mockSession.sendMessage).not.toHaveBeenCalled();
  });

  it('fallback an toàn khi không truyền cachedService và llmFactory', async () => {
    const turns: ChatHistoryTurnDto[] = Array.from({ length: 12 }, (_, i) => ({
      role: i % 2 === 0 ? EMessageRole.USER : EMessageRole.MODEL,
      text: `Turn ${i}`,
    }));

    const result = await ConversationHistorySummarizer.compress(
      turns,
      'conv-no-deps',
    );

    expect(result.history).toHaveLength(8);
    expect(result.history[0].text).toContain('[TÓM TẮT BỐI CẢNH CÁC LƯỢT TRÒ CHUYỆN TRƯỚC ĐÓ]');
  });
});
