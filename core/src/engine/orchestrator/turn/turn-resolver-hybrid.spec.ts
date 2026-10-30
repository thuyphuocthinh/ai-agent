import { Test, TestingModule } from '@nestjs/testing';
import { TurnResolverService } from './turn-resolver.service';
import { AutonomousEngine } from '../engines/autonomous.engine';
import { SmartExecutionRouter } from '../engines/smart-execution-router.service';
import { ReactLoopService } from '../../loop/react-loop.service';
import { SupervisorService } from '../../supervisor/supervisor.service';
import { AgentCancellationService } from '../../cancellation/agent-cancellation.service';
import { CheckpointPauseService } from '../../hitl/checkpoint-pause.service';
import { MetricsRegistryService } from '../../../infrastructure/resilience/metrics-registry.service';
import { MemoryManagerService } from '../../../memory/memory-manager.service';
import { ApprovalContinuationPlannerService } from '../../hitl/approval-continuation-planner.service';
import {
  EExecutionEngineMode,
  EForcedExecutionMode,
  EXECUTION_ENGINE_REGISTRY,
  EXECUTION_ROUTER,
  MESSAGE_SINK,
  STREAM_SINK,
  TOOL_PROVIDER,
} from '../../../contracts';
import { IProcessAiTriggerJobData } from '@agent/core/infrastructure/queue';
import { ApprovalRequiredError } from '../../loop/errors/approval-required.error';
import { ExecutionEngineRegistryService } from '../engines/execution-engine-registry.service';

describe('TurnResolverService — Adaptive Autonomous Multi-Agent (AC-1 & AC-2)', () => {
  let service: TurnResolverService;
  let mockMessageSink: {
    getMessageText: jest.Mock;
    getRecentHistory: jest.Mock;
  };
  let mockStreamSink: {
    publishStep: jest.Mock;
    publishFinalAnswer: jest.Mock;
  };
  let mockReactLoop: { run: jest.Mock };
  let mockSupervisor: {
    getAvailableAgents: jest.Mock;
    plan: jest.Mock;
    evaluate: jest.Mock;
    synthesize: jest.Mock;
  };
  let mockCancellation: { isCancelled: jest.Mock };
  let mockCheckpointPause: { pauseForApproval: jest.Mock; pauseForClarification: jest.Mock };
  let mockMetrics: { incrementBehaviorSignal: jest.Mock };
  let mockMemoryManager: { buildBudget: jest.Mock; getMemories: jest.Mock };

  const sampleData: IProcessAiTriggerJobData = {
    messageId: 'trigger-msg-1',
    channelId: 'chan-123',
    userId: 'user-456',
    sessionType: 'chat',
  };

  beforeEach(async () => {
    mockMessageSink = {
      getMessageText: jest
        .fn()
        .mockResolvedValue('Kiểm tra đơn hàng trong SQL và gửi thông báo vào Slack'),
      getRecentHistory: jest.fn().mockResolvedValue([]),
    };

    mockStreamSink = {
      publishStep: jest.fn().mockResolvedValue(undefined),
      publishFinalAnswer: jest.fn().mockResolvedValue(undefined),
      emitStep: jest.fn().mockResolvedValue(undefined),
    };

    mockReactLoop = {
      run: jest.fn(),
    };

    mockSupervisor = {
      getAvailableAgents: jest.fn().mockResolvedValue([
        { provider: 'sql_server', label: 'SQL Server' },
        { provider: 'slack', label: 'Slack' },
      ]),
      plan: jest.fn(),
      evaluate: jest.fn(),
      synthesize: jest.fn(),
    };

    mockCancellation = {
      isCancelled: jest.fn().mockResolvedValue(false),
    };

    mockCheckpointPause = {
      pauseForApproval: jest.fn(),
      pauseForClarification: jest.fn(),
    };

    mockMetrics = {
      incrementBehaviorSignal: jest.fn(),
    };

    mockMemoryManager = {
      buildBudget: jest.fn().mockReturnValue({ historyCharBudget: 2000 }),
      getMemories: jest.fn().mockResolvedValue([]),
    };

    mockReactLoop.run.mockResolvedValue({
      answer: 'Đã hoàn tất kiểm tra và gửi thông báo',
      toolCalls: [
        { tool: 'sql_server.read_query', status: 'success' },
        { tool: 'slack.post_message', status: 'success' },
      ],
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TurnResolverService,
        AutonomousEngine,
        SmartExecutionRouter,
        {
          provide: EXECUTION_ENGINE_REGISTRY,
          useFactory: (autonomous: AutonomousEngine) => {
            const registry = new ExecutionEngineRegistryService();
            registry.register(autonomous);
            return registry;
          },
          inject: [AutonomousEngine],
        },
        { provide: EXECUTION_ROUTER, useExisting: SmartExecutionRouter },
        { provide: MESSAGE_SINK, useValue: mockMessageSink },
        { provide: STREAM_SINK, useValue: mockStreamSink },
        { provide: ReactLoopService, useValue: mockReactLoop },
        { provide: SupervisorService, useValue: mockSupervisor },
        { provide: AgentCancellationService, useValue: mockCancellation },
        { provide: CheckpointPauseService, useValue: mockCheckpointPause },
        { provide: MetricsRegistryService, useValue: mockMetrics },
        { provide: MemoryManagerService, useValue: mockMemoryManager },
        { provide: TOOL_PROVIDER, useValue: { callTool: jest.fn() } },
        {
          provide: ApprovalContinuationPlannerService,
          useValue: { resolveRemainingSteps: jest.fn() },
        },
      ],
    }).compile();

    service = module.get<TurnResolverService>(TurnResolverService);
  });

  afterEach(() => {
    delete process.env.DEFAULT_ORCHESTRATION_MODE;
  });

  it('định tuyến yêu cầu thông thường trực tiếp vào Frontline ReAct của Autonomous Engine (< 2s) (AC-1)', async () => {
    const result = await service.resolveAnswer(sampleData, 'reply-msg-1');

    // Chạy thẳng Frontline ReAct của Autonomous Engine
    expect(mockReactLoop.run).toHaveBeenCalledWith(
      expect.objectContaining({
        providers: ['sql_server', 'slack'],
        prompt: 'Kiểm tra đơn hàng trong SQL và gửi thông báo vào Slack',
      }),
      undefined,
    );

    // Tuyệt đối không gọi Supervisor planning khi hội thoại thông thường
    expect(mockSupervisor.plan).not.toHaveBeenCalled();
    expect(result.content).toBe('Đã hoàn tất kiểm tra và gửi thông báo');
    expect(result.toolCalls).toHaveLength(2);
  });

  it('kích hoạt Tầng 2: Supervisor Planning khi có forcedMode=supervisor (AC-2)', async () => {
    process.env.DEFAULT_ORCHESTRATION_MODE = EForcedExecutionMode.SUPERVISOR;

    mockSupervisor.plan.mockResolvedValue({
      action: 'respond',
      answer: 'Kết quả từ Supervisor Planning',
    });

    const result = await service.resolveAnswer(sampleData, 'reply-msg-2');

    // Kích hoạt Supervisor
    expect(mockSupervisor.plan).toHaveBeenCalled();
    expect(result.content).toBe('Kết quả từ Supervisor Planning');
  });

  it('kích hoạt Tầng 2: Supervisor Planning khi payload vượt ngưỡng an toàn (> 30.000 ký tự) (AC-2)', async () => {
    mockMessageSink.getMessageText.mockResolvedValue('a'.repeat(30005));
    mockSupervisor.plan.mockResolvedValue({
      action: 'respond',
      answer: 'Kết quả tóm tắt payload quá khổ',
    });

    const result = await service.resolveAnswer(sampleData, 'reply-msg-3');

    expect(mockSupervisor.plan).toHaveBeenCalled();
    expect(result.content).toBe('Kết quả tóm tắt payload quá khổ');
  });

  it('tạm dừng và tạo checkpoint HITL an toàn khi Autonomous Engine gặp công cụ rủi ro cần duyệt (AC-4)', async () => {
    mockReactLoop.run.mockRejectedValueOnce(
      new ApprovalRequiredError(
        {
          provider: 'sql_server',
          name: 'execute_write_query',
          args: { query: 'DELETE FROM orders' },
        },
        [],
      ),
    );
    mockCheckpointPause.pauseForApproval.mockResolvedValueOnce({
      content: 'Đang chờ phê duyệt lệnh ghi',
      toolCalls: [],
      steps: [],
    });

    const result = await service.resolveAnswer(sampleData, 'reply-msg-4');

    expect(mockCheckpointPause.pauseForApproval).toHaveBeenCalledWith(
      sampleData,
      expect.any(String),
      [],
      expect.any(Array),
      expect.any(Array),
      expect.objectContaining({
        approvalRequired: expect.objectContaining({
          name: 'execute_write_query',
        }),
      }),
      [],
      EExecutionEngineMode.AUTONOMOUS,
    );
    expect(result.content).toBe('Đang chờ phê duyệt lệnh ghi');
  });
});
