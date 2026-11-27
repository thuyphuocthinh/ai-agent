import { Test, TestingModule } from '@nestjs/testing';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import {
  COMPACTION_SYSTEM_PROMPT,
  CONTEXT_EDITED_HISTORY_SECTION_HEADER,
  CONV_ARTIFACT_DIR_NAME,
  CONV_ARTIFACT_READ_TOOL_NAME,
  CONV_ARTIFACT_STATUS,
  CONVERSATION_SUMMARY_SECTION_HEADER,
  EMessageRole,
  NATIVE_TOOL_PROVIDER,
  ORCHESTRATION_CONSTANTS,
} from '@agent/core/constants';
import { IProcessAiTriggerJobData } from '@agent/core/infrastructure/queue';
import {
  resolveDataCharBudget,
  resolveHistoryCharBudget,
  resolveMemoryCharBudget,
} from '../../../common/text/token-budget.util';
import {
  CompactionMessageRecord,
  CONVERSATION_COMPACTION_REPOSITORY,
  ConversationCompactionState,
  IConversationCompactionRepository,
} from '../../../contracts/memory/conversation-compaction.interface';
import {
  CONVERSATION_ARTIFACT_STORE,
} from '../../../contracts/storage/conversation-artifact.interface';
import {
  CallToolRequestDto,
  CallToolResponseDto,
} from '../../../contracts/dtos/mcp.dto';
import { ChatHistoryTurnDto } from '../../../contracts/dtos/message-client.dto';
import {
  EXECUTION_ENGINE_REGISTRY,
  EXECUTION_ROUTER,
  IToolProvider,
  MESSAGE_SINK,
  STREAM_SINK,
  TOOL_PROVIDER,
  ToolContext,
} from '../../../contracts';
import { LocalConversationArtifactStore } from '../../../infrastructure/storage/local-conversation-artifact.store';
import { NativeToolRegistryService } from '../../../infrastructure/tools/native/native-tool-registry.service';
import { ReadConversationArtifactTool } from '../../../infrastructure/tools/native/read-conversation-artifact.tool';
import { McpToolConnectorService } from '../../../infrastructure/tools/mcp/mcp-tool-connector.service';
import { McpAuthClientService } from '../../../infrastructure/tools/mcp/mcp-auth-client.service';
import { DynamicProviderService } from '../../../infrastructure/tools/dynamic/dynamic-provider.service';
import { CircuitBreakerService } from '../../../infrastructure/resilience/circuit-breaker.service';
import { MetricsRegistryService } from '../../../infrastructure/resilience/metrics-registry.service';
import { MemoryManagerService } from '../../../memory/memory-manager.service';
import { AgentCancellationService } from '../../cancellation/agent-cancellation.service';
import { ApprovalContinuationPlannerService } from '../../hitl/approval-continuation-planner.service';
import { CheckpointPauseService } from '../../hitl/checkpoint-pause.service';
import { ReactLoopService } from '../../loop/react-loop.service';
import { LlmStrategyFactory } from '../../strategy/llm-strategy.factory';
import { AgentStreamService } from '../../streaming/agent-stream.service';
import { MessageClientService } from '../../streaming/message-client.service';
import { AgentRankingService } from '../../supervisor/agent-ranking.service';
import { SupervisorPromptBuilder } from '../../supervisor/supervisor-prompt.builder';
import { SupervisorService } from '../../supervisor/supervisor.service';
import { AutonomousEngine } from '../engines/autonomous.engine';
import { ExecutionEngineRegistryService } from '../engines/execution-engine-registry.service';
import { SmartExecutionRouter } from '../engines/smart-execution-router.service';
import { TurnResolverService } from '../turn/turn-resolver.service';
import { ConversationCompactionService } from './conversation-compaction.service';

jest.mock('@agent/core/common', () => ({
  extractTextFromMcpResult: jest.fn(
    (result?: { content?: { type: string; text?: string }[] }) =>
      (result?.content ?? [])
        .filter((c) => c.type === 'text' && c.text)
        .map((c) => c.text)
        .join('\n'),
  ),
}));

/**
 * In-memory backing store mô phỏng Prisma bảng ConversationMessage + Conversation.metadata.compaction
 * để test liên hoàn nhiều lượt hội thoại thực thụ mà không cần Docker/PostgreSQL.
 */
class InMemoryCompactionRepository implements IConversationCompactionRepository {
  private readonly states = new Map<string, ConversationCompactionState>();
  private readonly messages = new Map<string, CompactionMessageRecord[]>();

  appendMessage(
    conversationId: string,
    role: EMessageRole,
    text: string,
  ): string {
    const list = this.messages.get(conversationId) ?? [];
    const id = `msg-${list.length + 1}`;
    list.push({ id, role, text, createdAt: new Date(Date.now() + list.length * 1000) });
    this.messages.set(conversationId, list);
    return id;
  }

  async getCompactionState(
    conversationId: string,
  ): Promise<ConversationCompactionState | null> {
    return this.states.get(conversationId) ?? null;
  }

  async saveCompactionState(
    conversationId: string,
    state: ConversationCompactionState,
  ): Promise<void> {
    this.states.set(conversationId, state);
  }

  async getMessagesInWindow(params: {
    conversationId: string;
    afterMessageId?: string;
    beforeMessageId?: string;
    limit: number;
  }): Promise<CompactionMessageRecord[]> {
    const all = this.messages.get(params.conversationId) ?? [];
    let startIdx = 0;
    if (params.afterMessageId) {
      const idx = all.findIndex((m) => m.id === params.afterMessageId);
      if (idx >= 0) startIdx = idx + 1;
    }
    let endIdx = all.length;
    if (params.beforeMessageId) {
      const idx = all.findIndex((m) => m.id === params.beforeMessageId);
      if (idx >= 0) endIdx = idx;
    }
    return all.slice(startIdx, endIdx).slice(-params.limit);
  }
}

describe('Multi-turn Integration: Context Compaction + Context Editing + Isolated Artifact Handoff (no Docker)', () => {
  const CONV_ID = `int-conv-${Date.now()}`;
  const USER_ID = 'user-int-1';

  let moduleRef: TestingModule;
  let turnResolver: TurnResolverService;
  let compactionService: ConversationCompactionService;
  let artifactStore: LocalConversationArtifactStore;
  let inMemoryRepo: InMemoryCompactionRepository;

  const mockSendMessage = jest.fn();
  const mockGenerateStructured = jest.fn();
  const mockExternalCallTool = jest.fn();

  const originalMode = process.env.DEFAULT_ORCHESTRATION_MODE;

  beforeEach(async () => {
    process.env.DEFAULT_ORCHESTRATION_MODE = 'supervisor';
    jest.clearAllMocks();
    mockSendMessage.mockReset();
    mockGenerateStructured.mockReset();
    mockExternalCallTool.mockReset();

    inMemoryRepo = new InMemoryCompactionRepository();
    artifactStore = new LocalConversationArtifactStore();
    const nativeRegistry = new NativeToolRegistryService();
    const readArtifactTool = new ReadConversationArtifactTool(
      artifactStore,
      nativeRegistry,
    );
    readArtifactTool.onModuleInit();

    const hybridToolProvider: IToolProvider = {
      getTools: jest.fn(async (provider: string) => {
        if (provider === NATIVE_TOOL_PROVIDER) {
          return nativeRegistry.getAllTools();
        }
        return [
          {
            name: 'export_large_csv',
            description: 'Export oversized CSV report',
            inputSchema: { type: 'object', properties: {} },
          },
        ];
      }),
      callTool: jest.fn(
        async (
          dto: CallToolRequestDto,
          signal?: AbortSignal,
          context?: ToolContext,
        ): Promise<CallToolResponseDto> => {
          if (nativeRegistry.hasTool(dto.name)) {
            return nativeRegistry.executeFromRequest(dto, context, signal);
          }
          return mockExternalCallTool(dto);
        },
      ),
    };

    const mockStrategy = {
      id: 'gemini',
      startChat: jest.fn().mockReturnValue({ sendMessage: mockSendMessage }),
      generateStructured: mockGenerateStructured,
    };

    moduleRef = await Test.createTestingModule({
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
        SupervisorService,
        SupervisorPromptBuilder,
        ConversationCompactionService,
        AgentStreamService,
        { provide: STREAM_SINK, useExisting: AgentStreamService },
        {
          provide: CONVERSATION_COMPACTION_REPOSITORY,
          useValue: inMemoryRepo,
        },
        {
          provide: CONVERSATION_ARTIFACT_STORE,
          useValue: artifactStore,
        },
        { provide: TOOL_PROVIDER, useValue: hybridToolProvider },
        { provide: McpToolConnectorService, useValue: hybridToolProvider },
        {
          provide: McpAuthClientService,
          useValue: { getConnectionStatus: jest.fn().mockResolvedValue([]) },
        },
        {
          provide: DynamicProviderService,
          useValue: {
            getProvidersByUser: jest.fn().mockResolvedValue([
              {
                id: 'crm_export',
                name: 'CRM Export',
                description: 'Export large CSV reports',
              },
            ]),
          },
        },
        {
          provide: LlmStrategyFactory,
          useValue: {
            resolve: jest
              .fn()
              .mockReturnValue({ strategy: mockStrategy, model: 'gemini-2.5-flash' }),
          },
        },
        {
          provide: CircuitBreakerService,
          useValue: {
            run: jest.fn((_k: string, fn: () => Promise<unknown>) => fn()),
          },
        },
        {
          provide: MetricsRegistryService,
          useValue: { incrementBehaviorSignal: jest.fn() },
        },
        {
          provide: AgentCancellationService,
          useValue: { isCancelled: jest.fn().mockResolvedValue(false) },
        },
        {
          provide: CheckpointPauseService,
          useValue: {
            pauseForApproval: jest.fn(),
            pauseForClarification: jest.fn(),
          },
        },
        {
          provide: ApprovalContinuationPlannerService,
          useValue: { resolveRemainingSteps: jest.fn() },
        },
        {
          provide: AgentRankingService,
          useValue: {
            rankAgentsForPrompt: jest.fn(async (_p: string, a: unknown[]) => ({
              shown: a,
              omittedCount: 0,
            })),
            findAmbiguousAgentCluster: jest.fn().mockReturnValue(null),
          },
        },
        {
          provide: MemoryManagerService,
          useValue: {
            buildBudget: jest.fn((modelId: string) => ({
              toolResultCharBudget: resolveDataCharBudget(modelId),
              memoryCharBudget: resolveMemoryCharBudget(modelId),
              historyCharBudget: resolveHistoryCharBudget(modelId),
            })),
            getMemories: jest.fn().mockResolvedValue([]),
            recordUserDeclaredFact: jest.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: MessageClientService,
          useExisting: MESSAGE_SINK,
        },
        {
          provide: MESSAGE_SINK,
          useValue: {
            getMessageText: jest.fn().mockResolvedValue('fallback prompt'),
            getRecentHistory: jest.fn().mockResolvedValue([] as ChatHistoryTurnDto[]),
          },
        },
      ],
    }).compile();

    turnResolver = moduleRef.get(TurnResolverService);
    compactionService = moduleRef.get(ConversationCompactionService);
  });

  afterEach(async () => {
    if (originalMode === undefined) delete process.env.DEFAULT_ORCHESTRATION_MODE;
    else process.env.DEFAULT_ORCHESTRATION_MODE = originalMode;
    artifactStore.onModuleDestroy();
    await fs.rm(path.join(os.tmpdir(), CONV_ARTIFACT_DIR_NAME, CONV_ID), {
      recursive: true,
      force: true,
    });
    await moduleRef.close();
  });

  const buildJobData = (
    prompt: string,
    triggerId: string,
  ): IProcessAiTriggerJobData => ({
    userId: USER_ID,
    channelId: CONV_ID,
    conversationId: CONV_ID,
    workspaceId: 'ws-1',
    messageId: triggerId,
    prompt,
    botUserId: 'bot-1',
    channelType: 'web',
  });

  it('compacts after >10 turns, applies Context Editing to oversized AI turns, and reads oversized CSV artifacts across turns via real LocalConversationArtifactStore + ReadConversationArtifactTool', async () => {
    // --- Turns 1..5 (10 messages total = at threshold, compaction stays inactive) ---
    for (let turn = 1; turn <= 5; turn++) {
      const userPrompt =
        turn === 1
          ? 'Quy tắc: luôn dùng mã đơn ORD-778 khi đối chiếu'
          : `Câu hỏi turn ${turn}`;
      inMemoryRepo.appendMessage(CONV_ID, EMessageRole.USER, userPrompt);

      mockGenerateStructured.mockResolvedValueOnce({
        action: 'respond',
        answer:
          turn === 2
            ? `HEAD_TURN2_${'Z'.repeat(2400)}_TAIL_TURN2`
            : `Đáp turn ${turn}`,
      });

      const answer = await turnResolver.resolveAnswer(
        buildJobData(userPrompt, `trig-${turn}`),
        `reply-${turn}`,
      );
      inMemoryRepo.appendMessage(CONV_ID, EMessageRole.MODEL, answer.content);
      await compactionService.compactConversation(CONV_ID, 'gemini-2.5-flash');
    }

    // 10 tin nhắn chưa vượt COMPACTION_TRIGGER_TURNS (10) -> chưa nén
    expect(await inMemoryRepo.getCompactionState(CONV_ID)).toBeNull();

    // --- Turn 6 (đủ 12 tin > 10): Supervisor phải nhận bản Context Edited của câu AI turn 2, sau đó compaction kích hoạt ---
    inMemoryRepo.appendMessage(CONV_ID, EMessageRole.USER, 'Hỏi ở turn 6');
    mockGenerateStructured.mockResolvedValueOnce({
      action: 'respond',
      answer: 'Đáp turn 6',
    });

    const turn6Ans = await turnResolver.resolveAnswer(
      buildJobData('Hỏi ở turn 6', 'trig-6'),
      'reply-6',
    );
    expect(turn6Ans.content).toBe('Đáp turn 6');

    const turn6PlanPrompt = mockGenerateStructured.mock.calls[5][0].prompt as string;
    expect(turn6PlanPrompt).toContain(CONTEXT_EDITED_HISTORY_SECTION_HEADER);
    expect(turn6PlanPrompt).toContain('HEAD_TURN2_');
    expect(turn6PlanPrompt).toContain('TAIL_TURN2');
    expect(turn6PlanPrompt).toContain('đã lược bỏ');

    inMemoryRepo.appendMessage(CONV_ID, EMessageRole.MODEL, turn6Ans.content);

    // Compaction lần 1 chạy với COMPACTION_SYSTEM_PROMPT, giữ 6 tin cuối (#7..#12), nén #1..#6
    mockSendMessage.mockResolvedValueOnce({
      text: '[QUY TẮC & RÀNG BUỘC CÒN HIỆU LỰC]\n- Dùng mã ORD-778\n[VIỆC ĐÃ HOÀN THÀNH]\n- Đã trả lời turn 1..3\n[VIỆC ĐANG LÀM DỞ / CÂU HỎI ĐANG MỞ]\n- Chuẩn bị xuất CSV',
      toolCalls: [],
    });
    await compactionService.compactConversation(CONV_ID, 'gemini-2.5-flash');

    const compactedState = await inMemoryRepo.getCompactionState(CONV_ID);
    expect(compactedState).not.toBeNull();
    expect(compactedState?.summarizedUntilMessageId).toBe('msg-6');
    expect(mockSendMessage.mock.calls[0][0]).toContain('ORD-778');
    expect(mockSendMessage.mock.calls[0][0]).not.toContain('Đáp turn 6');

    // Kiểm tra systemInstruction compaction
    const compactionChatOpts = (mockSendMessage.mock.instances &&
      moduleRef
        .get(LlmStrategyFactory)
        .resolve('gemini-2.5-flash')
        .strategy.startChat) as jest.Mock;
    expect(compactionChatOpts).toHaveBeenCalledWith(
      expect.objectContaining({ systemInstruction: COMPACTION_SYSTEM_PROMPT }),
    );

    // --- Turn 7: Supervisor + ReAct đều nhận contextSummary + 6 tin chưa nén (#7..#12), offload CSV >50KB rồi đọc lại thật ---
    const largeCsv = [
      'order_id,customer,amount',
      ...Array.from({ length: 3000 }, (_, i) => `ORD-${i},Customer-${i},${i * 100}`),
    ].join('\n');
    expect(largeCsv.length).toBeGreaterThan(
      ORCHESTRATION_CONSTANTS.DIRECT_TO_DISK_CHAR_THRESHOLD,
    );

    let savedArtifactFilename = '';
    mockExternalCallTool.mockResolvedValueOnce({
      content: [{ type: 'text', text: largeCsv }],
      isError: false,
    });

    mockGenerateStructured.mockResolvedValueOnce({
      action: 'plan',
      steps: [
        {
          agent: 'crm_export',
          task: 'Xuất CSV lớn rồi đọc kiểm tra dòng đầu tiên',
          mustExecute: true,
        },
      ],
    });

    mockSendMessage
      .mockResolvedValueOnce({
        text: '',
        toolCalls: [{ id: 'tc-1', name: 'export_large_csv', args: {} }],
      })
      .mockImplementationOnce(async (toolResults: Array<{ name: string; content: string }>) => {
        const envelope = JSON.parse(toolResults[0].content);
        expect(envelope.status).toBe(CONV_ARTIFACT_STATUS);
        savedArtifactFilename = envelope.filename;
        return {
          text: '',
          toolCalls: [
            {
              id: 'tc-2',
              name: CONV_ARTIFACT_READ_TOOL_NAME,
              args: { filename: savedArtifactFilename, offsetChars: 0, limitChars: 60 },
            },
          ],
        };
      })
      .mockImplementationOnce(async (toolResults: Array<{ name: string; content: string }>) => {
        const readBack = JSON.parse(toolResults[0].content);
        expect(readBack.filename).toBe(savedArtifactFilename);
        expect(readBack.hasMore).toBe(true);
        expect(readBack.content).toContain('order_id,customer,amount');
        expect(readBack.content).toContain('ORD-0,Customer-0,0');
        return {
          text: `Đã xuất và đọc lại ${savedArtifactFilename}: dòng đầu là ORD-0.`,
          toolCalls: [],
        };
      });

    inMemoryRepo.appendMessage(CONV_ID, EMessageRole.USER, 'Xuất CSV và kiểm tra dòng đầu');
    const turn7Ans = await turnResolver.resolveAnswer(
      buildJobData('Xuất CSV và kiểm tra dòng đầu', 'trig-7'),
      'reply-7',
    );
    expect(turn7Ans.content).toContain(savedArtifactFilename);

    // Xác minh Supervisor plan() và ReactLoop startChat() đều nhận Summary từ compaction
    const turn7PlanPrompt = mockGenerateStructured.mock.calls[6][0].prompt as string;
    expect(turn7PlanPrompt).toContain(CONVERSATION_SUMMARY_SECTION_HEADER);
    expect(turn7PlanPrompt).toContain('Dùng mã ORD-778');
    expect(turn7PlanPrompt).not.toContain('HEAD_TURN2_'); // msg #4 đã được nén vào summary, không lặp lại ở history thô

    const reactStartChatCalls = (moduleRef
      .get(LlmStrategyFactory)
      .resolve('gemini-2.5-flash').strategy.startChat as jest.Mock).mock.calls;
    const reactOpts = reactStartChatCalls[reactStartChatCalls.length - 1][0];
    expect(reactOpts.systemInstruction).toContain(CONVERSATION_SUMMARY_SECTION_HEADER);
    expect(reactOpts.systemInstruction).toContain('Dùng mã ORD-778');

    // --- Turn 8 (cross-turn handoff): agent đọc lại phần sau của CÙNG artifact từ turn 7 qua offsetChars ---
    inMemoryRepo.appendMessage(CONV_ID, EMessageRole.MODEL, turn7Ans.content);
    inMemoryRepo.appendMessage(CONV_ID, EMessageRole.USER, 'Đọc tiếp phần sau của artifact vừa rồi');

    mockGenerateStructured.mockResolvedValueOnce({
      action: 'plan',
      steps: [
        {
          agent: 'crm_export',
          task: `Đọc phần tiếp theo của ${savedArtifactFilename}`,
          mustExecute: true,
        },
      ],
    });

    mockSendMessage
      .mockResolvedValueOnce({
        text: '',
        toolCalls: [
          {
            id: 'tc-3',
            name: CONV_ARTIFACT_READ_TOOL_NAME,
            args: { filename: savedArtifactFilename, offsetChars: 60, limitChars: 80 },
          },
        ],
      })
      .mockImplementationOnce(async (toolResults: Array<{ name: string; content: string }>) => {
        const slice2 = JSON.parse(toolResults[0].content);
        expect(slice2.offset).toBe(60);
        expect(slice2.content.length).toBeGreaterThan(0);
        return {
          text: `Đọc tiếp từ offset 60: ${slice2.content.slice(0, 20)}`,
          toolCalls: [],
        };
      });

    const turn8Ans = await turnResolver.resolveAnswer(
      buildJobData('Đọc tiếp phần sau của artifact vừa rồi', 'trig-8'),
      'reply-8',
    );
    expect(turn8Ans.content).toContain('Đọc tiếp từ offset 60:');
  });
});
