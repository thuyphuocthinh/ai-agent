import { Test, TestingModule } from '@nestjs/testing';
import { readUIMessageStream } from 'ai';
import type { UIMessage, UIMessageChunk } from 'ai';
import { IProcessAiTriggerJobData } from '@agent/core/infrastructure/queue';
import { McpToolConnectorService } from '../../../infrastructure/tools/mcp/mcp-tool-connector.service';
import { TurnResolverService } from './turn-resolver.service';
import { AutonomousEngine } from '../engines/autonomous.engine';
import { ApprovalContinuationPlannerService } from '../../hitl/approval-continuation-planner.service';
import { SmartExecutionRouter } from '../engines/smart-execution-router.service';
import { ExecutionEngineRegistryService } from '../engines/execution-engine-registry.service';
import { EXECUTION_ENGINE_REGISTRY, EXECUTION_ROUTER } from '../../../contracts';
import { MessageClientService } from '../../streaming/message-client.service';
import { ReactLoopService } from '../../loop/react-loop.service';
import { SupervisorService } from '../../supervisor/supervisor.service';
import {
  AgentStreamService,
  AgentStreamStep,
} from '../../streaming/agent-stream.service';
import { MESSAGE_SINK, STREAM_SINK, TOOL_PROVIDER } from '../../../contracts';
import { VercelUiStreamAdapter } from '../../../contracts/streaming/vercel-ui-stream.adapter';
import { LlmStrategyFactory } from '../../strategy/llm-strategy.factory';
import { CircuitBreakerService } from '../../../infrastructure/resilience/circuit-breaker.service';
import { AgentCancellationService } from '../../cancellation/agent-cancellation.service';
import { CheckpointPauseService } from '../../hitl/checkpoint-pause.service';
import { MetricsRegistryService } from '../../../infrastructure/resilience/metrics-registry.service';
import { MemoryManagerService } from '../../../memory/memory-manager.service';

// react-loop.service.ts / supervisor.service.ts import @agent/core/common ở module
// scope — mock barrel để tránh kéo theo "nanoid" (ESM-only), giống các spec khác.
jest.mock('@agent/core/common', () => ({
  extractTextFromMcpResult: jest.fn(
    (result?: { content?: { type: string; text?: string }[] }) =>
      (result?.content ?? [])
        .filter((c) => c.type === 'text' && c.text)
        .map((c) => c.text)
        .join('\n'),
  ),
}));

// Đầu-cuối thật: TurnResolverService + ReactLoopService + AgentStreamService thật,
// chỉ mock biên ngoài (Supervisor LLM, LLM session, MCP, hàng đợi/DB). Bằng chứng
// cho AC-2/AC-3/AC-5/AC-6/AC-7 trên ĐÚNG đường chạy của 1 turn — thứ mà bản làm
// trước thiếu (bridge không bao giờ được nối vào engine).
describe('1 turn thật → AgentStreamService → VercelUiStreamAdapter → ai@7 readUIMessageStream', () => {
  const REPLY_ID = 'reply-1';
  const data: IProcessAiTriggerJobData = {
    userId: 'user-1',
    channelId: 'channel-1',
    workspaceId: 'workspace-1',
    messageId: 'trigger-1',
    botUserId: 'bot-1',
    channelType: 'direct',
  };
  const persona = {
    role: 'Thanh tra Gian lận Tài chính',
    goal: 'Tìm nguyên nhân tiền không vào ví',
    constraints: ['Chỉ dùng quyền đọc'],
    tone: 'Thận trọng',
  };

  const mockSession = { sendMessage: jest.fn() };
  const mockStrategy = {
    id: 'gemini',
    startChat: jest.fn(),
    generateStructured: jest.fn(),
  };
  const mockMcp = {
    getTools: jest.fn(),
    getResources: jest.fn(),
    readResource: jest.fn(),
    callTool: jest.fn(),
  };
  const mockSupervisor = {
    getAvailableAgents: jest.fn(),
    plan: jest.fn(),
    evaluate: jest.fn(),
    synthesize: jest.fn(),
    checkCumulativeQuantity: jest.fn(),
  };

  let agentStream: AgentStreamService;
  let turnResolver: TurnResolverService;

  const originalMode = process.env.DEFAULT_ORCHESTRATION_MODE;

  beforeEach(async () => {
    // Spec này kiểm chứng đường Supervisor + persona, nên ép bỏ qua hybrid router.
    process.env.DEFAULT_ORCHESTRATION_MODE = 'supervisor';
    jest.clearAllMocks();
    mockSession.sendMessage.mockReset();
    mockStrategy.startChat.mockReturnValue(mockSession);
    mockStrategy.generateStructured.mockResolvedValue({ requiredCount: 0 });
    mockMcp.getTools.mockResolvedValue([
      { name: 'read_query', description: 'read-only SQL', inputSchema: {} },
    ]);
    mockMcp.getResources.mockResolvedValue([]);
    mockMcp.callTool.mockResolvedValue({
      content: [{ type: 'text', text: '[{"revenue":1250000}]' }],
      isError: false,
    });
    mockSupervisor.getAvailableAgents.mockResolvedValue([
      { provider: 'sql_server', label: 'SQL Server', description: 'desc' },
    ]);
    mockSupervisor.plan.mockResolvedValue({
      action: 'plan',
      steps: [
        {
          agent: 'sql_server',
          task: 'tính tổng doanh thu',
          mustExecute: true,
          persona,
        },
      ],
    });
    mockSupervisor.evaluate.mockResolvedValue({ verdict: 'done' });
    mockSupervisor.checkCumulativeQuantity.mockResolvedValue({
      requiredCount: 0,
      achievedCount: 0,
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
        ReactLoopService,
        AgentStreamService,
        { provide: STREAM_SINK, useExisting: AgentStreamService },
        { provide: TOOL_PROVIDER, useValue: mockMcp },
        {
          provide: MessageClientService,
          useExisting: MESSAGE_SINK,

        },
        {
          provide: MESSAGE_SINK,

          useValue: {
            getMessageText: jest.fn().mockResolvedValue('tổng doanh thu là bao nhiêu?'),
            getRecentHistory: jest.fn().mockResolvedValue([]),
          },
        },
        { provide: SupervisorService, useValue: mockSupervisor },
        {
          provide: ApprovalContinuationPlannerService,
          useValue: { resolveRemainingSteps: jest.fn() },
        },
        { provide: McpToolConnectorService, useValue: mockMcp },
        {
          provide: LlmStrategyFactory,
          useValue: {
            resolve: jest
              .fn()
              .mockReturnValue({ strategy: mockStrategy, model: 'gemini-2.0-flash' }),
          },
        },
        {
          provide: CircuitBreakerService,
          useValue: {
            run: jest.fn((_key: string, action: () => Promise<unknown>) => action()),
          },
        },
        {
          provide: AgentCancellationService,
          useValue: {
            isCancelled: jest.fn().mockResolvedValue(false),
            startTurn: jest.fn(),
            requestCancel: jest.fn(),
            getOwner: jest.fn(),
          },
        },
        { provide: CheckpointPauseService, useValue: { pauseForApproval: jest.fn() } },
        { provide: MetricsRegistryService, useValue: { incrementBehaviorSignal: jest.fn() } },
        {
          provide: MemoryManagerService,
          useValue: {
            buildBudget: jest.fn().mockReturnValue({
              toolResultCharBudget: 6000,
              memoryCharBudget: 600,
              historyCharBudget: 3000,
            }),
            getMemories: jest.fn().mockResolvedValue([]),
          },
        },
      ],
    }).compile();

    agentStream = module.get(AgentStreamService);
    turnResolver = module.get(TurnResolverService);
  });

  afterEach(async () => {
    if (originalMode === undefined) delete process.env.DEFAULT_ORCHESTRATION_MODE;
    else process.env.DEFAULT_ORCHESTRATION_MODE = originalMode;
    await agentStream.onModuleDestroy();
  });

  // Mô phỏng LLM: vòng 1 gọi tool; vòng 2 stream câu trả lời; vòng 3 (self-check)
  // stream thêm 1 đoạn rồi bị engine revert (resync) — đúng hành vi thật của ReactLoopRun.
  const scriptModel = (answer: string) => {
    mockSession.sendMessage
      .mockResolvedValueOnce({
        text: '',
        toolCalls: [{ name: 'read_query', args: { query: 'SELECT SUM(amount) FROM payments' } }],
      })
      .mockImplementationOnce(async (_input: unknown, onToken?: (chunk: string) => void) => {
        onToken?.(answer.slice(0, 10));
        onToken?.(answer.slice(10));
        return { text: answer, toolCalls: [] };
      });
  };

  async function runTurn() {
    const cliSeen: AgentStreamStep[] = [];
    agentStream.onStep((_ctx, step) => cliSeen.push(step));

    const chunks: UIMessageChunk[] = [];
    const adapter = new VercelUiStreamAdapter({
      messageId: REPLY_ID,
      write: (chunk) => void chunks.push(chunk),
    });
    adapter.attach(agentStream);

    const result = await turnResolver.resolveAnswer(data, REPLY_ID);
    // "done" do AiOrchestrationProcessor phát sau resolveAnswer — mô phỏng lại.
    await agentStream.emitStep(
      { userId: data.userId, channelId: data.channelId, messageId: REPLY_ID },
      { type: 'done' },
    );
    await adapter.flush();

    const stream = new ReadableStream<UIMessageChunk>({
      start(controller) {
        chunks.forEach((c) => controller.enqueue(c));
        controller.close();
      },
    });
    let message: UIMessage | undefined;
    for await (const m of readUIMessageStream({ stream })) message = m;

    return { result, message: message as UIMessage, chunks, cliSeen };
  }

  it('streams persona, the tool call/result pair and the answer as a valid UI message (AC-2, AC-7)', async () => {
    scriptModel('Doanh thu là 1.250.000đ.');

    const { message } = await runTurn();

    const parts = message.parts as Array<Record<string, unknown>>;
    expect(parts.find((p) => p.type === 'data-persona')).toMatchObject({ data: persona });

    const tool = parts.find((p) => p.type === 'dynamic-tool');
    expect(tool).toMatchObject({
      toolName: 'sql_server.read_query',
      state: 'output-available',
      // Engine chỉ phát argsPreview (chuỗi để hiển thị): với tham số `query` đơn
      // nó là SQL nguyên văn, nên input là { preview } chứ không phải { query }.
      input: { preview: 'SELECT SUM(amount) FROM payments' },
      output: '[{"revenue":1250000}]',
    });
    expect(tool?.toolCallId).toEqual(expect.stringMatching(/^call_/));

    const text = parts
      .filter((p) => p.type === 'text')
      .map((p) => p.text)
      .join('');
    expect(text).toContain('Doanh thu là 1.250.000đ.');

    // Persona xuất hiện TRƯỚC tool của bước đó.
    const order = parts.map((p) => p.type);
    expect(order.indexOf('data-persona')).toBeLessThan(order.indexOf('dynamic-tool'));
  });

  it('reports the engine-corrected text when the self-check round is reverted (data-resync)', async () => {
    mockMcp.getTools.mockResolvedValue([
      { name: 'get_database_schema', description: 'schema', inputSchema: {} },
    ]);
    mockSession.sendMessage
      .mockResolvedValueOnce({
        text: '',
        toolCalls: [{ name: 'get_database_schema', args: {} }],
      })
      .mockImplementationOnce(async (_input: unknown, onToken?: (chunk: string) => void) => {
        onToken?.('Doanh thu là 1.250.000đ.');
        return { text: 'Doanh thu là 1.250.000đ.', toolCalls: [] };
      })
      .mockImplementationOnce(async (_input: unknown, onToken?: (chunk: string) => void) => {
        onToken?.(' (đã tự kiểm tra lại)');
        return { text: 'Doanh thu là 1.250.000đ. (đã tự kiểm tra lại)', toolCalls: [] };
      });

    const { message } = await runTurn();

    expect(message.parts).toContainEqual(
      expect.objectContaining({
        type: 'data-resync',
        data: { text: 'Doanh thu là 1.250.000đ.' },
      }),
    );
  });

  it('feeds the persona to the worker prompt without changing its tools (AC-5)', async () => {
    scriptModel('Doanh thu là 1.250.000đ.');

    await runTurn();

    const options = mockStrategy.startChat.mock.calls[0][0];
    expect(options.systemInstruction).toContain('Vai trò: Thanh tra Gian lận Tài chính');
    expect(options.systemInstruction).toContain('Chỉ dùng quyền đọc');
    expect(options.tools.map((t: { name: string }) => t.name)).toEqual(['read_query']);
  });

  it('keeps every other listener of the same turn unaffected (AC-3)', async () => {
    scriptModel('Doanh thu là 1.250.000đ.');

    const { cliSeen } = await runTurn();

    const kinds = cliSeen.map((s) => s.type);
    expect(kinds).toEqual(
      expect.arrayContaining(['step_start', 'tool_call', 'tool_result', 'token', 'done']),
    );
    const call = cliSeen.find((s) => s.type === 'tool_call');
    const result = cliSeen.find((s) => s.type === 'tool_result');
    expect(call?.toolCallId).toBe(result?.toolCallId);
  });

  it('adds no warning when every figure of the answer comes from the tool output (AC-6)', async () => {
    scriptModel('Doanh thu là 1.250.000đ.');

    const { result } = await runTurn();

    expect(result.content).toBe('Doanh thu là 1.250.000đ.');
  });

  it('appends a warning when the answer states a figure that no tool returned (AC-6)', async () => {
    scriptModel('Doanh thu là 9.876.543đ.');

    const { result } = await runTurn();

    expect(result.content).toContain('Doanh thu là 9.876.543đ.');
    expect(result.content).toContain('⚠️');
    expect(result.content).toContain('9.876.543đ');
  });
});
