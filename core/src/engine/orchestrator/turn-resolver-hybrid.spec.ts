import { Test, TestingModule } from '@nestjs/testing';
import { TurnResolverService } from './turn-resolver.service';
import { SingleAgentEngine } from './single-agent.engine';
import { SmartExecutionRouter } from './smart-execution-router.service';
import { ExecutionEngineRegistryService } from './execution-engine-registry.service';
import { EXECUTION_ENGINE_REGISTRY, EXECUTION_ROUTER, EExecutionEngineMode } from '../../contracts';
import { ReactLoopService } from '../loop/react-loop.service';
import { SupervisorService } from '../supervisor/supervisor.service';
import { AgentCancellationService } from '../cancellation/agent-cancellation.service';
import { CheckpointPauseService } from '../hitl/checkpoint-pause.service';
import { MetricsRegistryService } from '../../common/metrics-registry.service';
import { MemoryManagerService } from '../../memory/memory-manager.service';
import { MESSAGE_SINK, STREAM_SINK } from '../../contracts';
import { IProcessAiTriggerJobData } from '@agent/core/infrastructure/queue';
import { ApprovalRequiredError } from '../loop/approval-required.error';

describe('TurnResolverService — Hybrid Orchestration Routing (AC-4 & AC-5)', () => {
  let service: TurnResolverService;

  const mockMessageSink = {
    getMessageText: jest.fn(),
    getRecentHistory: jest.fn().mockResolvedValue([]),
  };
  const mockStreamSink = { emitStep: jest.fn().mockResolvedValue(undefined) };
  const mockReactLoop = { run: jest.fn() };
  const mockSupervisor = {
    getAvailableAgents: jest.fn(),
    plan: jest.fn(),
    evaluate: jest.fn(),
    synthesize: jest.fn(),
  };
  const mockCancellation = { isCancelled: jest.fn().mockResolvedValue(false) };
  const mockCheckpointPause = {
    pauseForApproval: jest.fn(),
    pauseForClarification: jest.fn(),
  };
  const mockMetrics = {
    incrementBehaviorSignal: jest.fn(),
  };
  const mockMemoryManager = {
    buildBudget: jest.fn().mockReturnValue({
      dataCharBudget: 10000,
      historyCharBudget: 5000,
      memoryCharBudget: 2000,
      toolResultCharBudget: 10000,
    }),
  };

  const sampleData: IProcessAiTriggerJobData = {
    userId: 'user-1',
    channelId: 'channel-1',
    conversationId: 'channel-1',
    messageId: 'msg-1',
    workspaceId: 'workspace-1',
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    process.env.DEFAULT_ORCHESTRATION_MODE = 'hybrid';

    mockMessageSink.getMessageText.mockResolvedValue(
      'Kiểm tra đơn hàng trong SQL và gửi thông báo vào Slack',
    );
    mockSupervisor.getAvailableAgents.mockResolvedValue([
      { provider: 'sql_server', label: 'SQL Server', description: 'SQL DB' },
      { provider: 'slack', label: 'Slack', description: 'Slack Chat' },
    ]);
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
        SingleAgentEngine,
        SmartExecutionRouter,
        {
          provide: EXECUTION_ENGINE_REGISTRY,
          useFactory: (single: SingleAgentEngine) => {
            const registry = new ExecutionEngineRegistryService();
            registry.register(single);
            return registry;
          },
          inject: [SingleAgentEngine],
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
      ],
    }).compile();

    service = module.get<TurnResolverService>(TurnResolverService);
  });

  afterEach(() => {
    delete process.env.DEFAULT_ORCHESTRATION_MODE;
  });

  it('định tuyến yêu cầu thông thường trực tiếp vào Multi-Provider Single Agent, bỏ qua 4 bước Supervisor (AC-4)', async () => {
    const result = await service.resolveAnswer(sampleData, 'reply-msg-1');

    // Chạy thẳng Single Agent
    expect(mockReactLoop.run).toHaveBeenCalledWith(
      expect.objectContaining({
        providers: ['sql_server', 'slack'],
        prompt: 'Kiểm tra đơn hàng trong SQL và gửi thông báo vào Slack',
      }),
      undefined,
    );

    // Tuyệt đối không gọi Supervisor planning hay evaluate
    expect(mockSupervisor.plan).not.toHaveBeenCalled();
    expect(mockSupervisor.evaluate).not.toHaveBeenCalled();
    expect(mockSupervisor.synthesize).not.toHaveBeenCalled();

    expect(result.content).toBe('Đã hoàn tất kiểm tra và gửi thông báo');
    expect(result.toolCalls).toHaveLength(2);
  });

  it('tự động chuyển sang Multi-Agent Supervisor khi phát hiện điều kiện chạy song song (Parallel Fan-out) (AC-5)', async () => {
    mockMessageSink.getMessageText.mockResolvedValue(
      'Quét đồng thời 5 kênh Slack #dev, #ops, #sales để tìm kiếm sự cố',
    );
    mockSupervisor.plan.mockResolvedValue({
      action: 'respond',
      answer: 'Kết quả từ Supervisor',
    });

    const result = await service.resolveAnswer(sampleData, 'reply-msg-2');

    // Kích hoạt Supervisor
    expect(mockSupervisor.plan).toHaveBeenCalled();
    expect(mockReactLoop.run).not.toHaveBeenCalled();
    expect(result.content).toBe('Kết quả từ Supervisor');
  });

  it('tự động chuyển sang Multi-Agent Supervisor khi phát hiện điều kiện chạy Code Python Sandbox (AC-5)', async () => {
    mockMessageSink.getMessageText.mockResolvedValue(
      'Chạy script python để tính toán ma trận độ trễ',
    );
    mockSupervisor.plan.mockResolvedValue({
      action: 'respond',
      answer: 'Đã chạy python trên subagent compute',
    });

    const result = await service.resolveAnswer(sampleData, 'reply-msg-3');

    // Kích hoạt Supervisor
    expect(mockSupervisor.plan).toHaveBeenCalled();
    expect(result.content).toBe('Đã chạy python trên subagent compute');
  });

  it('tạm dừng và tạo checkpoint HITL an toàn khi Single Agent gặp công cụ rủi ro cần duyệt (AC-3)', async () => {
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
      answer: 'Đang chờ phê duyệt lệnh ghi',
      toolCalls: [],
      executionSteps: [],
      status: 'awaiting_approval',
    });

    const result = await service.resolveAnswer(sampleData, 'reply-msg-4');

    expect(mockCheckpointPause.pauseForApproval).toHaveBeenCalledWith(
      sampleData,
      expect.any(String),
      expect.arrayContaining([
        expect.objectContaining({ agent: 'sql_server' }),
      ]),
      expect.any(Array),
      expect.any(Array),
      expect.objectContaining({
        approvalRequired: expect.objectContaining({
          name: 'execute_write_query',
        }),
      }),
      [],
      EExecutionEngineMode.SINGLE_AGENT,
    );
    expect(result.status).toBe('awaiting_approval');
  });
});
