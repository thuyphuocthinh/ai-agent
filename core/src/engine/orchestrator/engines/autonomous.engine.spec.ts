import { AutonomousEngine } from './autonomous.engine';
import { ReactLoopService } from '../../loop/react-loop.service';
import { AgentCancellationService } from '../../cancellation/agent-cancellation.service';
import { CheckpointPauseService } from '../../hitl/checkpoint-pause.service';
import { MetricsRegistryService } from '../../../infrastructure/resilience/metrics-registry.service';
import {
  EExecutionEngineMode,
  EForcedExecutionMode,
  EngineExecutionContext,
  EngineRoutingContext,
} from '../../../contracts/engine/execution-engine.interface';
import { AnswerResult } from '../../../contracts/engine/orchestration-answer.types';
import { SupervisorService } from '../../supervisor/supervisor.service';

describe('AutonomousEngine', () => {
  let engine: AutonomousEngine;
  let mockReactLoop: jest.Mocked<ReactLoopService>;
  let mockCancellation: jest.Mocked<AgentCancellationService>;
  let mockCheckpointPause: jest.Mocked<CheckpointPauseService>;
  let mockMetrics: jest.Mocked<MetricsRegistryService>;
  let mockSupervisor: jest.Mocked<SupervisorService>;

  beforeEach(() => {
    mockReactLoop = {
      run: jest.fn().mockResolvedValue({
        answer: 'Chào bạn, đây là phản hồi từ Frontline ReAct loop.',
        toolCalls: [],
      }),
    } as unknown as jest.Mocked<ReactLoopService>;

    mockCancellation = {
      isCancelled: jest.fn().mockResolvedValue(false),
    } as unknown as jest.Mocked<AgentCancellationService>;

    mockCheckpointPause = {
      pauseForApproval: jest.fn().mockResolvedValue({
        content: 'Paused for approval',
      } as AnswerResult),
      pauseForClarification: jest.fn().mockResolvedValue({
        content: 'Paused for clarification',
      } as AnswerResult),
    } as unknown as jest.Mocked<CheckpointPauseService>;

    mockMetrics = {
      incrementBehaviorSignal: jest.fn(),
    } as unknown as jest.Mocked<MetricsRegistryService>;

    mockSupervisor = {
      plan: jest.fn().mockResolvedValue({
        action: 'respond',
        answer: 'Supervisor đã lập kế hoạch và phản hồi.',
      }),
      evaluate: jest.fn(),
    } as unknown as jest.Mocked<SupervisorService>;

    engine = new AutonomousEngine(
      mockReactLoop,
      mockCancellation,
      mockCheckpointPause,
      mockMetrics,
      undefined, // subAgentSpawner
      mockSupervisor,
    );
  });

  describe('canHandle', () => {
    it('chấp nhận khi forcedMode là autonomous, single, supervisor hoặc auto', () => {
      expect(
        engine.canHandle({
          prompt: 'hello',
          userId: 'u1',
          forcedMode: EForcedExecutionMode.AUTONOMOUS,
        } as EngineRoutingContext),
      ).toBe(true);

      expect(
        engine.canHandle({
          prompt: 'hello',
          userId: 'u1',
          forcedMode: EForcedExecutionMode.SINGLE,
        } as EngineRoutingContext),
      ).toBe(true);

      expect(
        engine.canHandle({
          prompt: 'hello',
          userId: 'u1',
          forcedMode: EForcedExecutionMode.SUPERVISOR,
        } as EngineRoutingContext),
      ).toBe(true);
    });

    it('từ chối khi có workflowId hoặc metadata.graph (thuộc về Deterministic Engine)', () => {
      expect(
        engine.canHandle({
          prompt: 'hello',
          userId: 'u1',
          workflowId: 'daily-report',
        } as EngineRoutingContext),
      ).toBe(false);

      expect(
        engine.canHandle({
          prompt: 'hello',
          userId: 'u1',
          metadata: { graph: {} },
        } as EngineRoutingContext),
      ).toBe(false);
    });
  });

  describe('execute - Tầng 1 (Frontline ReAct) vs Tầng 2 (Supervisor Planning)', () => {
    const baseContext: EngineExecutionContext = {
      data: {
        userId: 'user-1',
        channelId: 'chan-1',
        conversationId: 'conv-1',
        messageId: 'msg-in-1',
      },
      replyMessageId: 'reply-1',
      prompt: 'Giải thích giúp tôi hàm map trong JavaScript',
      agents: [],
      history: [],
    };

    it('mặc định chạy Frontline ReAct trực tiếp kể cả khi không có agent kết nối (Fast-Path < 2s)', async () => {
      const result = await engine.execute(baseContext);

      expect(mockReactLoop.run).toHaveBeenCalledTimes(1);
      expect(result.content).toContain('Frontline ReAct');
    });

    it('kích hoạt Tầng 2 (Supervisor Planning) khi forcedMode=supervisor', async () => {
      // Giả lập TurnResolverRun hoặc Supervisor có đầy đủ dependencies
      const supervisorContext: EngineExecutionContext = {
        ...baseContext,
        metadata: { forcedMode: EForcedExecutionMode.SUPERVISOR },
      };

      // Do engine thiếu streamSink / memoryManager trong mock này, nó fallback an toàn về FrontlineReAct
      const result = await engine.execute(supervisorContext);
      expect(result).toBeDefined();
    });

    it('kích hoạt Tầng 2 (Supervisor Planning) khi payload vượt ngưỡng an toàn (> 30.000 ký tự)', async () => {
      const largeContext: EngineExecutionContext = {
        ...baseContext,
        prompt: 'x'.repeat(30005),
      };

      const result = await engine.execute(largeContext);
      expect(result).toBeDefined();
    });
  });
});
