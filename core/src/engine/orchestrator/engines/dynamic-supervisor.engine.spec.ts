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
import { CheckpointService } from '../../hitl/checkpoint.service';

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

    describe('các nhánh cần giữ nguyên khi refactor', () => {
      const approvalCheckpoint = (overrides: Record<string, unknown> = {}): any => ({
        id: 'cp-sup-3',
        replyMessageId: 'reply-3',
        originalPrompt: 'Xóa đơn hàng cũ',
        pendingTask: 'Xóa đơn',
        kind: ECheckpointKind.APPROVAL,
        pendingTool: { provider: 'sql_server', name: 'execute_write_query', args: { q: 'DELETE' } },
        roundsSoFar: [{ agent: 'notion', task: 'bước trước', result: 'kết quả trước' }],
        remainingSteps: [],
        history: [{ role: 'user', text: 'lịch sử' }],
        userId: 'u1',
        workspaceId: 'w1',
        channelId: 'c1',
        botUserId: 'bot-1',
        channelType: 'web',
        sessionType: 'direct',
        conversationId: 'conv-1',
        ...overrides,
      });

      const buildEngineWithCheckpointService = (markToolExecuted: jest.Mock) =>
        new DynamicSupervisorEngine(
          mockReactLoop as unknown as ReactLoopService,
          mockSupervisor as unknown as SupervisorService,
          mockStreamSink as unknown as IStreamSink,
          mockCancellation as unknown as AgentCancellationService,
          mockCheckpointPause as unknown as CheckpointPauseService,
          mockMetrics as unknown as MetricsRegistryService,
          mockMemoryManager as unknown as MemoryManagerService,
          mockContinuationPlanner as unknown as ApprovalContinuationPlannerService,
          mockToolProvider as unknown as IToolProvider,
          { markToolExecuted } as unknown as CheckpointService,
        );

      it('trả thông báo lỗi và KHÔNG tiếp tục rounds khi tool đã duyệt thực thi thất bại (isError)', async () => {
        mockToolProvider.callTool.mockResolvedValue({
          content: [{ type: 'text', text: 'insufficient permission' }],
          isError: true,
        });
        jest.spyOn(engine, 'continueRounds');

        const result = await engine.resume(approvalCheckpoint());

        expect(result).toEqual({
          content:
            '⚠️ Hành động "execute_write_query" đã được duyệt nhưng thực thi thất bại:\ninsufficient permission',
        });
        expect(mockContinuationPlanner.resolveRemainingSteps).not.toHaveBeenCalled();
        expect(engine.continueRounds).not.toHaveBeenCalled();
      });

      it('vẫn đánh dấu tool đã thực thi khi tool trả isError (tool đã chạy xong, chỉ báo lỗi)', async () => {
        const markToolExecuted = jest.fn().mockResolvedValue(undefined);
        const withCheckpoint = buildEngineWithCheckpointService(markToolExecuted);
        mockToolProvider.callTool.mockResolvedValue({
          content: [{ type: 'text', text: 'lỗi' }],
          isError: true,
        });

        await withCheckpoint.resume(approvalCheckpoint());

        expect(markToolExecuted).toHaveBeenCalledWith({ id: 'cp-sup-3' });
      });

      it('đánh dấu đã thực thi SAU khi gọi tool và TRƯỚC khi lập tiếp các bước còn lại', async () => {
        const order: string[] = [];
        const markToolExecuted = jest.fn().mockImplementation(async () => {
          order.push('markToolExecuted');
        });
        mockToolProvider.callTool.mockImplementation(async () => {
          order.push('callTool');
          return { content: [{ type: 'text', text: 'ok' }], isError: false };
        });
        mockContinuationPlanner.resolveRemainingSteps.mockImplementation(async () => {
          order.push('resolveRemainingSteps');
          return { remainingSteps: [], resultText: 'x' };
        });
        const withCheckpoint = buildEngineWithCheckpointService(markToolExecuted);
        jest.spyOn(withCheckpoint, 'continueRounds').mockResolvedValue({ content: 'ok' });

        await withCheckpoint.resume(approvalCheckpoint());

        expect(order).toEqual(['callTool', 'markToolExecuted', 'resolveRemainingSteps']);
      });

      it('ném lỗi và không gọi tool khi checkpoint APPROVAL thiếu pendingTool', async () => {
        await expect(
          engine.resume(approvalCheckpoint({ pendingTool: undefined })),
        ).rejects.toThrow('Checkpoint approval thiếu thông tin pendingTool');

        expect(mockToolProvider.callTool).not.toHaveBeenCalled();
      });

      it('nối round vừa duyệt (đã cắt theo ngân sách) vào rounds trước đó và dùng remainingSteps do planner trả', async () => {
        mockMemoryManager.buildBudget.mockReturnValue({
          toolResultCharBudget: 50,
          memoryCharBudget: 600,
          historyCharBudget: 3000,
        });
        const leftover = [{ agent: 'slack', task: 'thông báo' }];
        mockContinuationPlanner.resolveRemainingSteps.mockResolvedValue({
          remainingSteps: leftover,
          resultText: 'x'.repeat(500),
        });
        jest.spyOn(engine, 'continueRounds').mockResolvedValue({ content: 'ok' });

        await engine.resume(approvalCheckpoint());

        const call = (engine.continueRounds as jest.Mock).mock.calls[0];
        const rounds = call[5] as Array<{ agent: string; task: string; result: string }>;
        expect(rounds).toHaveLength(2);
        expect(rounds[0]).toEqual({ agent: 'notion', task: 'bước trước', result: 'kết quả trước' });
        expect(rounds[1].agent).toBe('sql_server');
        expect(rounds[1].task).toBe('Xóa đơn');
        expect(rounds[1].result.length).toBeLessThan(500);
        expect(call[6]).toEqual([]); // toolCalls
        expect(call[7]).toBeUndefined(); // không có forcedStep
        expect(call[8]).toEqual(leftover);
      });

      it('dựng triggerData từ checkpoint và giữ lịch sử/rounds cho nhánh CLARIFICATION', async () => {
        jest.spyOn(engine, 'continueRounds').mockResolvedValue({ content: 'ok' });
        const roundsSoFar = [{ agent: 'notion', task: 't', result: 'r' }];
        const remainingSteps = [{ agent: 'slack', task: 'thông báo' }];

        await engine.resume(
          approvalCheckpoint({
            kind: ECheckpointKind.CLARIFICATION,
            selectedProvider: 'google_docs',
            pendingTool: undefined,
            roundsSoFar,
            remainingSteps,
          }),
        );

        const call = (engine.continueRounds as jest.Mock).mock.calls[0];
        expect(call[0]).toEqual({
          userId: 'u1',
          channelId: 'c1',
          workspaceId: 'w1',
          messageId: 'reply-3',
          botUserId: 'bot-1',
          channelType: 'web',
          sessionType: 'direct',
          conversationId: 'conv-1',
        });
        expect(call[4]).toEqual([{ role: 'user', text: 'lịch sử' }]);
        expect(call[5]).toBe(roundsSoFar);
        expect(call[7]).toEqual({ agent: 'google_docs', task: 'Xóa đơn' });
        expect(call[8]).toBe(remainingSteps);
        expect(mockToolProvider.callTool).not.toHaveBeenCalled();
      });
    });
  });
});
