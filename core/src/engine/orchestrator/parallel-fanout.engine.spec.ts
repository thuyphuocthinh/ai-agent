import { ParallelFanoutEngine } from './parallel-fanout.engine';
import { ReactLoopService } from '../loop/react-loop.service';
import { AgentCancellationService } from '../cancellation/agent-cancellation.service';
import { MetricsRegistryService } from '../../common/metrics-registry.service';
import { LlmStrategyFactory } from '../strategy/llm-strategy.factory';
import { TurnCancelledError } from '../loop/turn-cancelled.error';
import {
  EngineExecutionContext,
  EngineRoutingContext,
} from '../../contracts/execution-engine.interface';
import { FanoutDefinition } from '../../contracts/parallel-fanout.interface';
import { AnswerResult } from './orchestration-answer.types';

describe('ParallelFanoutEngine', () => {
  let engine: ParallelFanoutEngine;
  let mockReactLoop: jest.Mocked<ReactLoopService>;
  let mockCancellation: jest.Mocked<AgentCancellationService>;
  let mockMetrics: jest.Mocked<MetricsRegistryService>;
  let mockLlmFactory: jest.Mocked<LlmStrategyFactory>;
  let mockSendMessage: jest.Mock;

  beforeEach(() => {
    mockSendMessage = jest.fn().mockResolvedValue({ text: 'BÁO CÁO TỔNG HỢP: Shopee rẻ nhất, Lazada giao nhanh nhất.' });

    mockLlmFactory = {
      resolve: jest.fn().mockReturnValue({
        strategy: {
          startChat: jest.fn().mockReturnValue({
            sendMessage: mockSendMessage,
          }),
        },
        model: 'mock-premium-model',
      }),
    } as unknown as jest.Mocked<LlmStrategyFactory>;

    mockReactLoop = {
      run: jest.fn(),
    } as unknown as jest.Mocked<ReactLoopService>;

    mockCancellation = {
      isCancelled: jest.fn().mockResolvedValue(false),
    } as unknown as jest.Mocked<AgentCancellationService>;

    mockMetrics = {
      incrementBehaviorSignal: jest.fn(),
    } as unknown as jest.Mocked<MetricsRegistryService>;

    engine = new ParallelFanoutEngine(
      mockReactLoop,
      mockCancellation,
      mockMetrics,
      mockLlmFactory,
    );
  });

  const baseContext: EngineExecutionContext = {
    data: {
      userId: 'u1',
      channelId: 'c1',
      conversationId: 'conv-1',
      messageId: 'msg-in-1',
    },
    replyMessageId: 'reply-fanout-1',
    prompt: 'So sánh giá iPhone 16 đồng thời trên Shopee, Lazada và Tiki',
    agents: [],
    history: [],
  };

  const ecommerceFanout: FanoutDefinition = {
    id: 'price-compare-fanout',
    name: 'So sánh giá đa sàn',
    workers: [
      { id: 'shopee', name: 'Shopee', provider: 'shopee_mcp' },
      { id: 'lazada', name: 'Lazada', provider: 'lazada_mcp' },
      { id: 'tiki', name: 'Tiki', provider: 'tiki_mcp' },
    ],
    aggregatorModel: 'claude-3-5-sonnet',
  };

  describe('canHandle', () => {
    it('nhận diện khi forcedMode="fanout"', () => {
      expect(engine.canHandle({ prompt: 'test', userId: 'u1', forcedMode: 'fanout' } as EngineRoutingContext)).toBe(true);
    });

    it('tự động nhận diện prompt có từ khóa song song/đồng thời', () => {
      expect(engine.canHandle({ prompt: 'Tìm kiếm đồng thời trên nhiều nguồn', userId: 'u1' } as EngineRoutingContext)).toBe(true);
      expect(engine.canHandle({ prompt: 'Cào đồng thời 3 sàn thương mại', userId: 'u1' } as EngineRoutingContext)).toBe(true);
      expect(engine.canHandle({ prompt: 'fan-out 5 workers độc lập', userId: 'u1' } as EngineRoutingContext)).toBe(true);
    });

    it('nhận diện khi metadata.fanout được truyền', () => {
      expect(engine.canHandle({ prompt: 'tác vụ thường', userId: 'u1', metadata: { fanout: {} } } as EngineRoutingContext)).toBe(true);
    });

    it('từ chối khi forcedMode được chỉ định cho engine khác', () => {
      expect(engine.canHandle({ prompt: 'test', userId: 'u1', forcedMode: 'single' } as EngineRoutingContext)).toBe(false);
      expect(engine.canHandle({ prompt: 'test', userId: 'u1', forcedMode: 'pipeline' } as EngineRoutingContext)).toBe(false);
    });
  });

  describe('executeFanout', () => {
    it('chạy 3 workers song song và tổng hợp qua Aggregator Model thành công', async () => {
      mockReactLoop.run
        .mockResolvedValueOnce({ answer: 'Shopee: 28.990.000đ', toolCalls: [] })
        .mockResolvedValueOnce({ answer: 'Lazada: 29.500.000đ, giao hàng nhanh 2h', toolCalls: [] })
        .mockResolvedValueOnce({ answer: 'Tiki: 29.200.000đ, freeship', toolCalls: [] });

      const result = await engine.executeFanout(ecommerceFanout, baseContext);

      // 3 workers chạy song song
      expect(mockReactLoop.run).toHaveBeenCalledTimes(3);

      // Aggregator được gọi 1 lần với model xịn
      expect(mockLlmFactory.resolve).toHaveBeenCalledWith('claude-3-5-sonnet');
      expect(mockSendMessage).toHaveBeenCalledTimes(1);

      // Prompt Aggregator phải chứa kết quả từ cả 3 worker
      const aggregatorPromptArg = mockSendMessage.mock.calls[0][0] as string;
      expect(aggregatorPromptArg).toContain('Shopee: 28.990.000đ');
      expect(aggregatorPromptArg).toContain('Lazada: 29.500.000đ');
      expect(aggregatorPromptArg).toContain('Tiki: 29.200.000đ');

      // Kết quả cuối là nội dung Aggregator tổng hợp
      expect(result.content).toContain('BÁO CÁO TỔNG HỢP');

      // ExecutedSteps: 3 workers + 1 aggregator
      expect(result.steps).toHaveLength(4);
      expect(result.steps?.[0].agent).toBe('shopee');
      expect(result.steps?.[3].agent).toBe('aggregator');

      expect(mockMetrics.incrementBehaviorSignal).toHaveBeenCalledWith('parallel_fanout_completed');
    });

    it('tiếp tục và ghi nhận lỗi khi 1 worker thất bại, các worker khác vẫn chạy', async () => {
      mockReactLoop.run
        .mockResolvedValueOnce({ answer: 'Shopee: 28.990.000đ', toolCalls: [] })
        .mockRejectedValueOnce(new Error('Lazada API timeout'))
        .mockResolvedValueOnce({ answer: 'Tiki: 29.200.000đ', toolCalls: [] });

      const result = await engine.executeFanout(ecommerceFanout, baseContext);

      // Tất cả 3 workers vẫn được gọi
      expect(mockReactLoop.run).toHaveBeenCalledTimes(3);

      // Aggregator vẫn chạy để tổng hợp từ 2 worker thành công
      expect(mockSendMessage).toHaveBeenCalledTimes(1);
      const aggregatorPromptArg = mockSendMessage.mock.calls[0][0] as string;
      expect(aggregatorPromptArg).toContain('Lazada API timeout');

      // Kết quả cuối vẫn hợp lệ
      expect(result.content).toContain('BÁO CÁO TỔNG HỢP');

      // 3 workers (1 lỗi) + 1 aggregator = 4 steps
      expect(result.steps).toHaveLength(4);
      expect(result.steps?.[1].result).toContain('[Lỗi]');
    });

    it('trả về thông báo rõ ràng khi TẤT CẢ workers đều thất bại', async () => {
      mockReactLoop.run.mockRejectedValue(new Error('Network down'));

      const result = await engine.executeFanout(ecommerceFanout, baseContext);

      // Aggregator KHÔNG gọi LLM khi không có dữ liệu
      expect(mockSendMessage).not.toHaveBeenCalled();
      expect(result.content).toContain('không thể cung cấp kết quả');
    });

    it('tuân thủ maxConcurrency khi có nhiều workers hơn giới hạn (batch chạy tuần tự)', async () => {
      const largeFanout: FanoutDefinition = {
        id: 'large-fanout',
        name: 'Large Fan-Out',
        workers: [
          { id: 'w1', name: 'Worker 1' },
          { id: 'w2', name: 'Worker 2' },
          { id: 'w3', name: 'Worker 3' },
        ],
        maxConcurrency: 2, // Chỉ 2 worker cùng lúc → 2 batches
        aggregatorModel: 'claude-3-5-sonnet',
      };

      mockReactLoop.run.mockResolvedValue({ answer: 'Kết quả', toolCalls: [] });

      await engine.executeFanout(largeFanout, baseContext);

      // Tất cả 3 workers đều chạy (2 batch: batch1=[w1,w2], batch2=[w3])
      expect(mockReactLoop.run).toHaveBeenCalledTimes(3);
    });

    it('ném TurnCancelledError ngay lập tức khi lượt chạy đã bị hủy', async () => {
      mockCancellation.isCancelled.mockResolvedValue(true);

      await expect(engine.executeFanout(ecommerceFanout, baseContext)).rejects.toThrow(TurnCancelledError);
      expect(mockReactLoop.run).not.toHaveBeenCalled();
    });
  });
});
