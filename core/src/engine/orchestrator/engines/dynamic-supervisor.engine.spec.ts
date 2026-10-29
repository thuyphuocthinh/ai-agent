import { DynamicSupervisorEngine } from './dynamic-supervisor.engine';
import { SupervisorService } from '../../supervisor/supervisor.service';
import { ApprovalContinuationPlannerService } from '../../hitl/approval-continuation-planner.service';
import { ECheckpointKind, EExecutionEngineMode } from '@agent/core/constants';
import { EngineExecutionContext, EngineRoutingContext } from '../../../contracts/engine/execution-engine.interface';
import { ReactLoopService } from '../../loop/react-loop.service';
import { AgentCancellationService } from '../../cancellation/agent-cancellation.service';
import { CheckpointPauseService } from '../../hitl/checkpoint-pause.service';
import { MetricsRegistryService } from '../../../infrastructure/resilience/metrics-registry.service';
import { MemoryManagerService } from '../../../memory/memory-manager.service';
import { IStreamSink, IToolProvider } from '../../../contracts';

describe('DynamicSupervisorEngine', () => {
  let engine: DynamicSupervisorEngine;
  let mockReactLoop: { run: jest.Mock };
  let mockSupervisor: {
    getAvailableAgents: jest.Mock;
    plan: jest.Mock;
    evaluate: jest.Mock;
    synthesize: jest.Mock;
    checkCumulativeQuantity: jest.Mock;
  };
  let mockStreamSink: {
    emitDelta: jest.Mock;
    emitStep: jest.Mock;
    emitPlan: jest.Mock;
    emitDone: jest.Mock;
    emitError: jest.Mock;
  };
  let mockCancellation: { isCancelled: jest.Mock };
  let mockCheckpointPause: { pauseForClarification: jest.Mock; pauseForApproval: jest.Mock };
  let mockMetrics: { incrementBehaviorSignal: jest.Mock };
  let mockMemoryManager: {
    buildBudget: jest.Mock;
    getMemories: jest.Mock;
    recordUserDeclaredFact: jest.Mock;
  };
  let mockContinuationPlanner: { resolveRemainingSteps: jest.Mock };
  let mockToolProvider: { callTool: jest.Mock };

  beforeEach(() => {
    mockReactLoop = { run: jest.fn() };
    mockSupervisor = {
      getAvailableAgents: jest.fn().mockResolvedValue([
        { provider: 'sql_server', label: 'SQL Server' },
      ]),
      plan: jest.fn(),
      evaluate: jest.fn(),
      synthesize: jest.fn(),
      checkCumulativeQuantity: jest.fn().mockResolvedValue({ requiredCount: 0, achievedCount: 0 }),
    };
    mockStreamSink = {
      emitDelta: jest.fn(),
      emitStep: jest.fn(),
      emitPlan: jest.fn(),
      emitDone: jest.fn(),
      emitError: jest.fn(),
    };
    mockCancellation = {
      isCancelled: jest.fn().mockResolvedValue(false),
    };
    mockCheckpointPause = {
      pauseForClarification: jest.fn(),
      pauseForApproval: jest.fn(),
    };
    mockMetrics = {
      incrementBehaviorSignal: jest.fn(),
    };
    mockMemoryManager = {
      buildBudget: jest.fn().mockReturnValue({
        toolResultCharBudget: 6000,
        memoryCharBudget: 600,
        historyCharBudget: 3000,
      }),
      getMemories: jest.fn().mockResolvedValue([]),
      recordUserDeclaredFact: jest.fn().mockResolvedValue(undefined),
    };
    mockContinuationPlanner = {
      resolveRemainingSteps: jest.fn().mockResolvedValue({
        remainingSteps: [],
        resultText: 'Tool result processed',
      }),
    };
    mockToolProvider = {
      callTool: jest.fn().mockResolvedValue({
        content: [{ type: 'text', text: 'query result' }],
        isError: false,
      }),
    };

    engine = new DynamicSupervisorEngine(
      mockReactLoop as unknown as ReactLoopService,
      mockSupervisor as unknown as SupervisorService,
      mockStreamSink as unknown as IStreamSink,
      mockCancellation as unknown as AgentCancellationService,
      mockCheckpointPause as unknown as CheckpointPauseService,
      mockMetrics as unknown as MetricsRegistryService,
      mockMemoryManager as unknown as MemoryManagerService,
      mockContinuationPlanner as unknown as ApprovalContinuationPlannerService,
      mockToolProvider as unknown as IToolProvider,
    );
  });

  describe('canHandle', () => {
    it('chấp nhận khi forcedMode="supervisor"', () => {
      expect(
        engine.canHandle({ prompt: 'test', userId: 'u1', forcedMode: 'supervisor' } as EngineRoutingContext),
      ).toBe(true);
    });

    it('từ chối khi forcedMode khác "supervisor"', () => {
      expect(
        engine.canHandle({ prompt: 'test', userId: 'u1', forcedMode: 'single' } as EngineRoutingContext),
      ).toBe(false);
    });
  });

  describe('execute', () => {
    it('gọi continueRounds để khởi chạy Supervisor', async () => {
      jest.spyOn(engine, 'continueRounds').mockResolvedValue({
        content: 'Supervisor round completed',
        toolCalls: [],
      });

      const context: EngineExecutionContext = {
        data: { userId: 'u1', channelId: 'c1', workspaceId: 'w1', messageId: 'm1' } as any,
        replyMessageId: 'reply-1',
        prompt: 'Tìm kiếm dữ liệu',
        agents: [],
        history: [],
      };

      const result = await engine.execute(context);

      expect(engine.continueRounds).toHaveBeenCalledWith(
        context.data,
        'reply-1',
        'Tìm kiếm dữ liệu',
        [],
        [],
        [],
        [],
        undefined,
        undefined,
        undefined,
      );
      expect(result.content).toBe('Supervisor round completed');
    });
  });

  describe('resume', () => {
    it('tiếp tục với forcedStep khi checkpoint là CLARIFICATION', async () => {
      jest.spyOn(engine, 'continueRounds').mockResolvedValue({
        content: 'Supervisor round completed',
        toolCalls: [],
      });

      const checkpoint: any = {
        id: 'cp-sup-1',
        replyMessageId: 'reply-1',
        originalPrompt: 'Lưu thông tin',
        pendingTask: 'Lưu vào hệ thống',
        kind: ECheckpointKind.CLARIFICATION,
        selectedProvider: 'notion',
        roundsSoFar: [],
        remainingSteps: [],
        history: [],
        userId: 'u1',
        workspaceId: 'w1',
        channelId: 'c1',
        botUserId: 'bot-1',
        channelType: 'web',
      };

      const result = await engine.resume(checkpoint);

      expect(mockSupervisor.getAvailableAgents).toHaveBeenCalledWith('u1', 'w1');
      expect(engine.continueRounds).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'u1', messageId: 'reply-1' }),
        'reply-1',
        'Lưu thông tin',
        expect.any(Array),
        [],
        [],
        [],
        { agent: 'notion', task: 'Lưu vào hệ thống' },
        [],
      );
      expect(result.content).toBe('Supervisor round completed');
    });

    it('thực thi tool và tiếp tục rounds khi checkpoint là APPROVAL', async () => {
      jest.spyOn(engine, 'continueRounds').mockResolvedValue({
        content: 'Supervisor round completed',
        toolCalls: [],
      });

      const checkpoint: any = {
        id: 'cp-sup-2',
        replyMessageId: 'reply-2',
        originalPrompt: 'Xóa đơn hàng cũ',
        pendingTask: 'Xóa đơn',
        kind: ECheckpointKind.APPROVAL,
        pendingTool: { provider: 'sql_server', name: 'execute_write_query', args: { q: 'DELETE' } },
        roundsSoFar: [],
        remainingSteps: [],
        history: [],
        userId: 'u1',
        workspaceId: 'w1',
        channelId: 'c1',
        botUserId: 'bot-1',
        channelType: 'web',
      };

      const result = await engine.resume(checkpoint);

      expect(mockToolProvider.callTool).toHaveBeenCalledWith({
        provider: 'sql_server',
        name: 'execute_write_query',
        args: { q: 'DELETE' },
        ownerId: 'u1',
        workspaceId: 'w1',
      });
      expect(mockContinuationPlanner.resolveRemainingSteps).toHaveBeenCalled();
      expect(engine.continueRounds).toHaveBeenCalled();
      expect(result.content).toBe('Supervisor round completed');
    });
  });
});
