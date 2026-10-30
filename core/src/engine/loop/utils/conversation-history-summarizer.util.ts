import {
  CACHE,
  EMessageRole,
  ORCHESTRATION_CONSTANTS,
  CONVERSATION_SUMMARY_SYSTEM_PROMPT,
  CONVERSATION_SUMMARY_ACK_TEXT,
  buildConversationSummaryPrompt,
} from '@agent/core/constants';
import { ChatHistoryTurnDto } from '../../../contracts/dtos/message-client.dto';
import { CachedService } from '../../../infrastructure/redis/cached.service';
import { LlmStrategyFactory } from '../../strategy/llm-strategy.factory';

export interface SummarizedHistoryResult {
  history: ChatHistoryTurnDto[];
  contextSummary?: string;
}

/**
 * ConversationHistorySummarizer
 *
 * Tiện ích nén ngữ cảnh đàm thoại đệ quy (Recursive Context Compression) cho các cuộc trò chuyện dài (> 10 turns).
 * Giúp AutonomousEngine khắc phục bệnh "mất trí nhớ ngữ cảnh" khi các quyết định nghiệp vụ ở turn đầu bị trôi khỏi sliding window.
 *
 * Quy tắc:
 * 1. Hội thoại <= 10 turns: Giữ nguyên 100% nguyên văn.
 * 2. Hội thoại > 10 turns: Tách làm 2 phần:
 *    - Các turn cũ (1..N-6): Tóm tắt thành 1 bản tóm tắt súc tích, lưu cache Redis 1h (Singleflight).
 *    - 6 turn gần nhất: Giữ nguyên văn để bảo toàn tính liên tục của hội thoại.
 *    - Chèn bản tóm tắt vào đầu danh sách làm Context Anchor Turn.
 */
export class ConversationHistorySummarizer {
  static readonly MAX_RAW_TURNS = 10;
  static readonly PRESERVED_RECENT_TURNS = 6;

  /**
   * Tự động nén lịch sử nếu vượt quá ngưỡng an toàn.
   */
  static async compress(
    history: ChatHistoryTurnDto[] | undefined,
    conversationId: string,
    cachedService?: CachedService,
    llmFactory?: LlmStrategyFactory,
  ): Promise<SummarizedHistoryResult> {
    if (!history || history.length <= this.MAX_RAW_TURNS) {
      return { history: history ?? [] };
    }

    const splitIndex = history.length - this.PRESERVED_RECENT_TURNS;
    const olderTurns = history.slice(0, splitIndex);
    const recentTurns = history.slice(splitIndex);

    const lastOldTurn = olderTurns[olderTurns.length - 1];
    const turnMarker = `${olderTurns.length}_${(lastOldTurn.id ?? lastOldTurn.text ?? '').slice(0, 20)}`;
    const cacheKey = CACHE.SUMMARY.KEYS.CONVERSATION(
      conversationId || 'default_conv',
      turnMarker,
    );

    let summaryText: string;

    if (cachedService && llmFactory) {
      summaryText = await cachedService.getOrSetDetail(
        cacheKey,
        CACHE.SUMMARY.SETTINGS.TTL,
        async () => this.generateSummary(olderTurns, llmFactory),
      );
    } else if (llmFactory) {
      summaryText = await this.generateSummary(olderTurns, llmFactory);
    } else {
      // Fallback không có LLM/Cache: tóm tắt văn bản thô
      summaryText = olderTurns
        .map((t) => `${String(t.role).toUpperCase()}: ${t.text.slice(0, 100)}`)
        .join('\n');
    }

    const contextAnchorTurn: ChatHistoryTurnDto = {
      role: EMessageRole.USER,
      text: `[TÓM TẮT BỐI CẢNH CÁC LƯỢT TRÒ CHUYỆN TRƯỚC ĐÓ]:\n${summaryText}`,
    };

    const ackTurn: ChatHistoryTurnDto = {
      role: EMessageRole.MODEL,
      text: CONVERSATION_SUMMARY_ACK_TEXT,
    };

    return {
      history: [contextAnchorTurn, ackTurn, ...recentTurns],
      contextSummary: summaryText,
    };
  }

  /**
   * Sinh tóm tắt qua LLM Fast/Cheap Tier với chi phí token tối thiểu.
   */
  private static async generateSummary(
    turns: ChatHistoryTurnDto[],
    llmFactory: LlmStrategyFactory,
  ): Promise<string> {
    const cheapModel =
      process.env.CHEAP_TIER_MODEL ??
      process.env.DEFAULT_REACT_MODEL ??
      ORCHESTRATION_CONSTANTS.DEFAULT_REACT_MODEL;
    const { strategy, model } = llmFactory.resolve(cheapModel);

    const formattedTranscript = turns
      .map((t) => `${String(t.role).toUpperCase()}: ${t.text}`)
      .join('\n');

    const prompt = buildConversationSummaryPrompt(formattedTranscript);

    const session = strategy.startChat({
      model,
      systemInstruction: CONVERSATION_SUMMARY_SYSTEM_PROMPT,
      tools: [],
      history: [],
      temperature: 0.1,
    });

    const response = await session.sendMessage(prompt);
    return response.text.trim();
  }
}
