import {
  COMPACTION_SYSTEM_PROMPT,
  EMessageRole,
  ORCHESTRATION_CONSTANTS,
} from '@agent/core/constants';
import {
  CompactionMessageRecord,
  IConversationCompactionRepository,
} from '../../../contracts/memory/conversation-compaction.interface';
import { LlmStrategyFactory } from '../../strategy/llm-strategy.factory';
import { ConversationCompactionService } from './conversation-compaction.service';

describe('ConversationCompactionService', () => {
  const mockRepo: jest.Mocked<IConversationCompactionRepository> = {
    getCompactionState: jest.fn(),
    saveCompactionState: jest.fn(),
    getMessagesInWindow: jest.fn(),
  };
  const mockSendMessage = jest.fn();
  const mockStrategy = {
    id: 'gemini',
    startChat: jest.fn().mockReturnValue({ sendMessage: mockSendMessage }),
    generateStructured: jest.fn(),
  };
  const mockLlmFactory = {
    resolve: jest.fn().mockReturnValue({
      strategy: mockStrategy,
      model: 'gemini-2.5-flash',
    }),
  };

  let service: ConversationCompactionService;

  const buildRecords = (count: number): CompactionMessageRecord[] =>
    Array.from({ length: count }, (_, idx) => ({
      id: `msg-${idx + 1}`,
      role: idx % 2 === 0 ? EMessageRole.USER : EMessageRole.MODEL,
      text: `Nội dung tin ${idx + 1}`,
    }));

  beforeEach(() => {
    jest.clearAllMocks();
    service = new ConversationCompactionService(
      mockRepo,
      mockLlmFactory as unknown as LlmStrategyFactory,
    );
  });

  describe('loadEffectiveContext', () => {
    it('loads summary and edits/trims turns after summarizedUntilMessageId', async () => {
      mockRepo.getCompactionState.mockResolvedValueOnce({
        summary: '[VIỆC ĐÃ HOÀN THÀNH]\n- Đã tạo sheet s1',
        summarizedUntilMessageId: 'msg-6',
        updatedAt: '2026-11-27T00:00:00.000Z',
      });
      mockRepo.getMessagesInWindow.mockResolvedValueOnce(buildRecords(3));

      const ctx = await service.loadEffectiveContext('conv-1', 'gpt-4o');

      expect(mockRepo.getMessagesInWindow).toHaveBeenCalledWith({
        conversationId: 'conv-1',
        afterMessageId: 'msg-6',
        limit: ORCHESTRATION_CONSTANTS.COMPACTION_FETCH_CAP,
      });
      expect(ctx.summary).toContain('Đã tạo sheet s1');
      expect(ctx.recentTurns).toHaveLength(3);
    });
  });

  describe('compactConversation', () => {
    it('skips LLM call when pending messages do not exceed COMPACTION_TRIGGER_TURNS', async () => {
      mockRepo.getCompactionState.mockResolvedValueOnce(null);
      mockRepo.getMessagesInWindow.mockResolvedValueOnce(
        buildRecords(ORCHESTRATION_CONSTANTS.COMPACTION_TRIGGER_TURNS),
      );

      await service.compactConversation('conv-1');

      expect(mockStrategy.startChat).not.toHaveBeenCalled();
      expect(mockRepo.saveCompactionState).not.toHaveBeenCalled();
    });

    it('compacts older messages while preserving COMPACTION_KEEP_RECENT_TURNS uncompacted', async () => {
      const total = ORCHESTRATION_CONSTANTS.COMPACTION_TRIGGER_TURNS + 2; // 12
      const keep = ORCHESTRATION_CONSTANTS.COMPACTION_KEEP_RECENT_TURNS; // 6
      mockRepo.getCompactionState.mockResolvedValueOnce({
        summary: 'Summary 0',
        summarizedUntilMessageId: 'msg-0',
        updatedAt: '2026-11-27T00:00:00.000Z',
      });
      mockRepo.getMessagesInWindow.mockResolvedValueOnce(buildRecords(total));
      mockSendMessage.mockResolvedValueOnce({
        text: 'Summary hợp nhất mới',
        toolCalls: [],
      });

      await service.compactConversation('conv-1', 'gemini-2.5-flash');

      expect(mockStrategy.startChat).toHaveBeenCalledWith(
        expect.objectContaining({
          systemInstruction: COMPACTION_SYSTEM_PROMPT,
          temperature: ORCHESTRATION_CONSTANTS.COMPACTION_LLM_TEMPERATURE,
        }),
      );
      const sentPrompt = mockSendMessage.mock.calls[0][0] as string;
      expect(sentPrompt).toContain('Summary 0');
      expect(sentPrompt).toContain('Nội dung tin 6');
      expect(sentPrompt).not.toContain('Nội dung tin 7');

      expect(mockRepo.saveCompactionState).toHaveBeenCalledWith(
        'conv-1',
        expect.objectContaining({
          summary: 'Summary hợp nhất mới',
          summarizedUntilMessageId: `msg-${total - keep}`,
        }),
      );
    });

    it('prevents concurrent overlapping compactions for the same conversationId', async () => {
      let resolveLlm!: (value: { text: string; toolCalls: [] }) => void;
      mockRepo.getCompactionState.mockResolvedValue(null);
      mockRepo.getMessagesInWindow.mockResolvedValue(buildRecords(12));
      mockSendMessage.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveLlm = resolve;
          }),
      );

      const first = service.compactConversation('conv-lock');
      const second = service.compactConversation('conv-lock');

      await second;
      await new Promise<void>((resolve) => setImmediate(resolve));
      resolveLlm({ text: 'Done', toolCalls: [] });
      await first;

      expect(mockSendMessage).toHaveBeenCalledTimes(1);
    });
  });
});
