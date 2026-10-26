import { SingleAgentEngine } from './single-agent.engine';
import { ReactLoopService } from '../loop/react-loop.service';
import { AgentCancellationService } from '../cancellation/agent-cancellation.service';
import { CheckpointPauseService } from '../hitl/checkpoint-pause.service';
import { MetricsRegistryService } from '../../common/metrics-registry.service';
import { TurnCancelledError } from '../loop/turn-cancelled.error';
import { ApprovalRequiredError } from '../loop/approval-required.error';
import { EngineExecutionContext, EngineRoutingContext } from '../../contracts/execution-engine.interface';
import { PendingToolCall } from '../../infrastructure/database/entities/orchestration-checkpoint.entity';
import { AnswerResult } from './orchestration-answer.types';

describe('SingleAgentEngine', () => {
  let engine: SingleAgentEngine;
  let mockReactLoop: jest.Mocked<ReactLoopService>;
  let mockCancellation: jest.Mocked<AgentCancellationService>;
  let mockCheckpointPause: jest.Mocked<CheckpointPauseService>;
  let mockMetrics: jest.Mocked<MetricsRegistryService>;

  beforeEach(() => {
    mockReactLoop = {
      run: jest.fn().mockResolvedValue({
        answer: 'Xin chào, tôi đã tìm thấy dữ liệu trên SQL và gửi tin nhắn Slack thành công.',
        toolCalls: [
          { tool: 'sql__query', status: 'success' },
          { tool: 'slack__send_message', status: 'success' },
        ],
      }),
    } as unknown as jest.Mocked<ReactLoopService>;

    mockCancellation = {
      isCancelled: jest.fn().mockResolvedValue(false),
    } as unknown as jest.Mocked<AgentCancellationService>;

    mockCheckpointPause = {
      pauseForApproval: jest.fn().mockResolvedValue({
        content: 'Paused for approval',
      } as AnswerResult),
    } as unknown as jest.Mocked<CheckpointPauseService>;

    mockMetrics = {
      incrementBehaviorSignal: jest.fn(),
    } as unknown as jest.Mocked<MetricsRegistryService>;

    engine = new SingleAgentEngine(
      mockReactLoop,
      mockCancellation,
      mockCheckpointPause,
      mockMetrics,
    );
  });

  describe('canHandle', () => {
    it('chấp nhận xử lý khi forcedMode="single" hoặc "auto" hoặc mặc định', () => {
      expect(engine.canHandle({ prompt: 'test', userId: 'u1', forcedMode: 'single' } as EngineRoutingContext)).toBe(true);
      expect(engine.canHandle({ prompt: 'test', userId: 'u1', forcedMode: 'auto' } as EngineRoutingContext)).toBe(true);
      expect(engine.canHandle({ prompt: 'test', userId: 'u1' } as EngineRoutingContext)).toBe(true);
    });

    it('từ chối khi forcedMode được chỉ định cho engine khác (ví dụ: supervisor)', () => {
      expect(engine.canHandle({ prompt: 'test', userId: 'u1', forcedMode: 'supervisor' } as EngineRoutingContext)).toBe(false);
      expect(engine.canHandle({ prompt: 'test', userId: 'u1', forcedMode: 'pipeline' } as EngineRoutingContext)).toBe(false);
    });
  });

  describe('execute', () => {
    const defaultContext: EngineExecutionContext = {
      data: {
        userId: 'user-1',
        channelId: 'chan-1',
        conversationId: 'conv-1',
        messageId: 'msg-in-1',
        tenantId: 'tenant-1',
      },
      replyMessageId: 'msg-reply-1',
      prompt: 'Tìm kiếm khách hàng trong SQL và gửi thông báo Slack',
      agents: [
        { id: 'a1', provider: 'sql_server', name: 'SQL', description: '' },
        { id: 'a2', provider: 'slack', name: 'Slack', description: '' },
      ],
      history: [],
    };

    it('thực thi thành công ReAct loop với đa provider và đóng gói ExecutedStepDto', async () => {
      const result = await engine.execute(defaultContext);

      expect(result.content).toContain('Xin chào, tôi đã tìm thấy dữ liệu');
      expect(result.toolCalls).toHaveLength(2);
      expect(result.steps).toHaveLength(1);
      expect(result.steps?.[0].agent).toBe('single_agent');
      expect(result.steps?.[0].persona?.role).toBe('Multi-Provider Single Agent');
      expect(mockReactLoop.run).toHaveBeenCalledTimes(1);
    });

    it('dừng lại và gọi CheckpointPauseService khi gặp ApprovalRequiredError', async () => {
      const pendingTool: PendingToolCall = {
        name: 'delete_customer',
        provider: 'sql_server',
        args: { id: 123 },
      };

      mockReactLoop.run.mockRejectedValue(
        new ApprovalRequiredError(pendingTool, 'Xóa khách hàng #123', []),
      );

      const result = await engine.execute(defaultContext);

      expect(mockMetrics.incrementBehaviorSignal).toHaveBeenCalledWith('approval_required');
      expect(mockCheckpointPause.pauseForApproval).toHaveBeenCalledTimes(1);
      expect(result.content).toBe('Paused for approval');
    });

    it('ném TurnCancelledError khi lượt chạy đã bị hủy', async () => {
      mockCancellation.isCancelled.mockResolvedValue(true);

      await expect(engine.execute(defaultContext)).rejects.toThrow(TurnCancelledError);
    });
  });
});
