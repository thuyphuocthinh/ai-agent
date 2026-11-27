import { config as loadEnv } from 'dotenv';
import { randomUUID } from 'crypto';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

loadEnv({ path: ['.env', '../.env'] });

jest.mock('uuid', () => ({
  v4: () => randomUUID(),
  v7: () => randomUUID(),
}));

jest.mock('@agent/core/common', () => ({
  extractTextFromMcpResult: jest.fn(
    (result?: { content?: { type: string; text?: string }[] }) =>
      (result?.content ?? [])
        .filter((c) => c.type === 'text' && c.text)
        .map((c) => c.text)
        .join('\n'),
  ),
}));

import { Test, TestingModule } from '@nestjs/testing';
import {
  COMPACTION_SYSTEM_PROMPT,
  CONTEXT_EDITED_HISTORY_SECTION_HEADER,
  CONV_ARTIFACT_DIR_NAME,
  CONV_ARTIFACT_READ_TOOL_NAME,
  CONV_ARTIFACT_STATUS,
  CONVERSATION_SUMMARY_SECTION_HEADER,
  EMessageRole,
  HISTORY_SEARCH_TOOL_NAME,
  NATIVE_TOOL_PROVIDER,
  ORCHESTRATION_CONSTANTS,
} from '@agent/core/constants';
import { IProcessAiTriggerJobData } from '@agent/core/infrastructure/queue';
import {
  resolveDataCharBudget,
  resolveHistoryCharBudget,
  resolveMemoryCharBudget,
} from '../../../common/text/token-budget.util';
import { asJsonObject } from '../../../common/text/structured-payload.util';
import { CONVERSATION_COMPACTION_REPOSITORY } from '../../../contracts/memory/conversation-compaction.interface';
import { CONVERSATION_HISTORY_SEARCH_REPOSITORY } from '../../../contracts/memory/conversation-history-search.interface';
import { CONVERSATION_ARTIFACT_STORE } from '../../../contracts/storage/conversation-artifact.interface';
import {
  CallToolRequestDto,
  CallToolResponseDto,
} from '../../../contracts/dtos/mcp.dto';
import {
  EXECUTION_ENGINE_REGISTRY,
  EXECUTION_ROUTER,
  IToolProvider,
  MESSAGE_SINK,
  STREAM_SINK,
  TOOL_PROVIDER,
  ToolContext,
} from '../../../contracts';
import { PrismaService } from '../../../infrastructure/database/prisma.service';
import { PrismaConversationCompactionRepository } from '../../../infrastructure/database/adapters/prisma-conversation-compaction.repository';
import { PrismaConversationHistorySearchRepository } from '../../../infrastructure/database/adapters/prisma-conversation-history-search.repository';
import { PrismaMessageSink } from '../../../infrastructure/database/adapters/prisma-message-sink';
import { LocalConversationArtifactStore } from '../../../infrastructure/storage/local-conversation-artifact.store';
import { NativeToolRegistryService } from '../../../infrastructure/tools/native/native-tool-registry.service';
import { ReadConversationArtifactTool } from '../../../infrastructure/tools/native/read-conversation-artifact.tool';
import { SearchConversationHistoryTool } from '../../../infrastructure/tools/native/search-conversation-history.tool';
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

// Chạy thật với PostgreSQL (PrismaService + PrismaMessageSink + PrismaConversationCompactionRepository).
// Đặt SKIP_POSTGRES_TESTS=1 để bỏ qua khi không có DB local.
const describeWithPostgres =
  process.env.SKIP_POSTGRES_TESTS || !process.env.DATABASE_URL
    ? describe.skip
    : describe;

describeWithPostgres(
  'Multi-turn PostgreSQL Integration (Type 1): 20 turns + 2-round Rolling Compaction + Context Editing + Artifact Handoff + History Search',
  () => {
    const CONV_ID = randomUUID();
    const USER_ID = '00000000-0000-7000-8000-000000000001';

    let moduleRef: TestingModule;
    let prisma: PrismaService;
    let messageSink: PrismaMessageSink;
    let compactionRepo: PrismaConversationCompactionRepository;
    let compactionService: ConversationCompactionService;
    let turnResolver: TurnResolverService;
    let artifactStore: LocalConversationArtifactStore;

    const mockSendMessage = jest.fn();
    const mockGenerateStructured = jest.fn();
    const mockExternalCallTool = jest.fn();
    const mockStartChat = jest.fn().mockReturnValue({
      sendMessage: mockSendMessage,
    });

    const originalMode = process.env.DEFAULT_ORCHESTRATION_MODE;

    beforeAll(async () => {
      process.env.DEFAULT_ORCHESTRATION_MODE = 'supervisor';

      artifactStore = new LocalConversationArtifactStore();

      const mockStrategy = {
        id: 'gemini',
        startChat: mockStartChat,
        generateStructured: mockGenerateStructured,
      };

      moduleRef = await Test.createTestingModule({
        providers: [
          PrismaService,
          PrismaMessageSink,
          PrismaConversationCompactionRepository,
          PrismaConversationHistorySearchRepository,
          NativeToolRegistryService,
          ReadConversationArtifactTool,
          SearchConversationHistoryTool,
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
            useExisting: PrismaConversationCompactionRepository,
          },
          {
            provide: CONVERSATION_HISTORY_SEARCH_REPOSITORY,
            useExisting: PrismaConversationHistorySearchRepository,
          },
          { provide: MESSAGE_SINK, useExisting: PrismaMessageSink },
          { provide: MessageClientService, useExisting: PrismaMessageSink },
          { provide: CONVERSATION_ARTIFACT_STORE, useValue: artifactStore },
          {
            provide: TOOL_PROVIDER,
            useFactory: (nativeRegistry: NativeToolRegistryService): IToolProvider => ({
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
            }),
            inject: [NativeToolRegistryService],
          },
          { provide: McpToolConnectorService, useExisting: TOOL_PROVIDER },
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
              resolve: jest.fn().mockReturnValue({
                strategy: mockStrategy,
                model: 'gemini-2.5-flash',
              }),
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
        ],
      }).compile();

      await moduleRef.init();
      prisma = moduleRef.get(PrismaService);
      messageSink = moduleRef.get(PrismaMessageSink);
      compactionRepo = moduleRef.get(PrismaConversationCompactionRepository);
      compactionService = moduleRef.get(ConversationCompactionService);
      turnResolver = moduleRef.get(TurnResolverService);
    });

    afterAll(async () => {
      if (originalMode === undefined) delete process.env.DEFAULT_ORCHESTRATION_MODE;
      else process.env.DEFAULT_ORCHESTRATION_MODE = originalMode;

      artifactStore?.onModuleDestroy();
      await fs.rm(path.join(os.tmpdir(), CONV_ARTIFACT_DIR_NAME, CONV_ID), {
        recursive: true,
        force: true,
      });

      if (prisma) {
        await prisma.conversationMessage.deleteMany({
          where: { conversationId: CONV_ID },
        });
        await prisma.conversation.deleteMany({
          where: { id: CONV_ID },
        });
      }
      await moduleRef?.close();
    });

    const buildJobData = (
      prompt: string,
      triggerId: string,
    ): IProcessAiTriggerJobData => ({
      userId: USER_ID,
      channelId: CONV_ID,
      conversationId: CONV_ID,
      workspaceId: 'default',
      messageId: triggerId,
      prompt,
      botUserId: 'bot-1',
      channelType: 'web',
    });

    it(
      'persists 20 turns into PostgreSQL, executes 2 rolling compactions, filters pause banners, applies Context Editing, hands off artifacts, and searches history via native tool at Turn 20',
      async () => {
      const eligibleMessageIds: string[] = [];

      const recordTurnToDb = async (
        userPrompt: string,
        aiAnswer: string,
      ): Promise<{ userMsgId: string; aiMsgId: string }> => {
        const userCreated = await messageSink.addUserMessage({
          conversationId: CONV_ID,
          text: userPrompt,
        });
        eligibleMessageIds.push(userCreated.id);

        const aiCreated = await messageSink.createMessage({
          channelId: CONV_ID,
          senderId: 'bot-1',
          content: aiAnswer,
        });
        eligibleMessageIds.push(aiCreated.id);
        return { userMsgId: userCreated.id, aiMsgId: aiCreated.id };
      };

      const preTriggerTurns = Math.floor(
        ORCHESTRATION_CONSTANTS.COMPACTION_TRIGGER_TURNS / 2,
      ); // 11 turns = 22 eligible messages

      // === Turns 1..11 (22 eligible DB messages -> chưa vượt COMPACTION_TRIGGER_TURNS = 22) ===
      for (let turn = 1; turn <= preTriggerTurns; turn++) {
        const userPrompt =
          turn === 1
            ? 'Quy tắc cố định: luôn gắn mã khách VIP-9910 và mã đơn ORD-8899.'
            : turn === 3
              ? 'Ghi chú kho cũ: tủ hồ sơ mật đặt mã CABINET-Z91 ở phòng A.'
              : `Câu hỏi turn ${turn}: Kiểm tra trạng thái mục ${turn}.`;
        const aiText =
          turn === 2
            ? `HEAD_PG2_${'A'.repeat(2800)}_TAIL_PG2`
            : turn === 3
              ? 'Đã ghi nhận mã tủ hồ sơ mật CABINET-Z91 cho lượt 3.'
              : `Đáp án chi tiết turn ${turn}: đã kiểm tra mục ${turn}.`;

        const userCreated = await messageSink.addUserMessage({
          conversationId: CONV_ID,
          text: userPrompt,
        });
        eligibleMessageIds.push(userCreated.id);

        mockGenerateStructured.mockResolvedValueOnce({
          action: 'respond',
          answer: aiText,
        });

        const ans = await turnResolver.resolveAnswer(
          buildJobData(userPrompt, userCreated.id),
          randomUUID(),
        );
        expect(ans.content).toBe(aiText);

        const aiCreated = await messageSink.createMessage({
          channelId: CONV_ID,
          senderId: 'bot-1',
          content: ans.content,
        });
        eligibleMessageIds.push(aiCreated.id);

        await compactionService.compactConversation(CONV_ID, 'gemini-2.5-flash');
      }

      // Chèn 1 tin nhắn pause HITL giả lập giữa đường để xác minh Postgres filter loại bỏ nó
      await prisma.conversationMessage.create({
        data: {
          id: randomUUID(),
          conversationId: CONV_ID,
          role: 'ASSISTANT',
          text: '⏸️ Cần bạn duyệt thao tác gửi email hàng loạt',
          isText: true,
          metadata: {},
        },
      });

      expect(
        await prisma.conversationMessage.count({
          where: { conversationId: CONV_ID },
        }),
      ).toBe(preTriggerTurns * 2 + 1); // 22 eligible + 1 banner pause
      expect(await compactionRepo.getCompactionState(CONV_ID)).toBeNull();
      expect(mockSendMessage).not.toHaveBeenCalled();

      // === Turn 12 (đủ 24 eligible DB messages > 22): Supervisor đọc Context Edited turn 2 + Compaction lần 1 ===
      const triggerTurn = preTriggerTurns + 1; // 12
      const turn12User = await messageSink.addUserMessage({
        conversationId: CONV_ID,
        text: `Turn ${triggerTurn}: Tiếp tục tổng hợp tình hình.`,
      });
      eligibleMessageIds.push(turn12User.id);

      mockGenerateStructured.mockResolvedValueOnce({
        action: 'respond',
        answer: `Đáp turn ${triggerTurn} xong.`,
      });
      const turn12TriggerAns = await turnResolver.resolveAnswer(
        buildJobData(
          `Turn ${triggerTurn}: Tiếp tục tổng hợp tình hình.`,
          turn12User.id,
        ),
        randomUUID(),
      );
      expect(turn12TriggerAns.content).toBe(`Đáp turn ${triggerTurn} xong.`);

      const triggerPlanPrompt = mockGenerateStructured.mock.calls[preTriggerTurns][0]
        .prompt as string;
      expect(triggerPlanPrompt).toContain(CONTEXT_EDITED_HISTORY_SECTION_HEADER);
      expect(triggerPlanPrompt).toContain('HEAD_PG2_');
      expect(triggerPlanPrompt).toContain('TAIL_PG2');
      expect(triggerPlanPrompt).toContain('đã lược bỏ');
      expect(triggerPlanPrompt).not.toContain('⏸️ Cần bạn duyệt');

      const turn12Ai = await messageSink.createMessage({
        channelId: CONV_ID,
        senderId: 'bot-1',
        content: turn12TriggerAns.content,
      });
      eligibleMessageIds.push(turn12Ai.id);

      const SUMMARY_1 = [
        '[QUY TẮC & RÀNG BUỘC CÒN HIỆU LỰC]',
        '- Khách hàng VIP-9910, mã đơn ORD-8899 bắt buộc gắn vào mọi báo cáo.',
        '[VIỆC ĐÃ HOÀN THÀNH]',
        '- Hoàn tất rà soát các mục đầu phiên.',
        '[VIỆC ĐANG LÀM DỞ / CÂU HỎI ĐANG MỞ]',
        '- Chuẩn bị xuất báo cáo CSV.',
      ].join('\n');

      mockSendMessage.mockResolvedValueOnce({
        text: SUMMARY_1,
        toolCalls: [],
      });
      await compactionService.compactConversation(CONV_ID, 'gemini-2.5-flash');

      // Kiểm tra trực tiếp row Conversation.metadata trong PostgreSQL
      const compacted1Count =
        triggerTurn * 2 - ORCHESTRATION_CONSTANTS.COMPACTION_KEEP_RECENT_TURNS; // 24 - 14 = 10
      const convRowAfter1 = await prisma.conversation.findUnique({
        where: { id: CONV_ID },
        select: { metadata: true },
      });
      const compactionJson1 = asJsonObject(
        asJsonObject(convRowAfter1?.metadata)?.compaction,
      );
      expect(compactionJson1).toBeTruthy();
      expect(compactionJson1?.summary).toBe(SUMMARY_1);
      expect(compactionJson1?.summarizedUntilMessageId).toBe(
        eligibleMessageIds[compacted1Count - 1], // msg #10
      );

      // Prompt compaction #1 chỉ gồm #1..#10 (không chứa #11..#24 như 'Đáp turn 12 xong.')
      const compactPrompt1 = mockSendMessage.mock.calls[0][0] as string;
      expect(compactPrompt1).toContain('VIP-9910');
      expect(compactPrompt1).toContain('ORD-8899');
      expect(compactPrompt1).toContain('HEAD_PG2_');
      expect(compactPrompt1).not.toContain(`Đáp turn ${triggerTurn} xong.`);
      expect(compactPrompt1).not.toContain('⏸️ Cần bạn duyệt');
      expect(mockStartChat).toHaveBeenCalledWith(
        expect.objectContaining({ systemInstruction: COMPACTION_SYSTEM_PROMPT }),
      );

      // === Turn 13: Offload CSV >50KB sang artifact + đọc cắt lát thật, đồng thời Supervisor & ReAct đều nhận Summary 1 ===
      const largeCsv = [
        'order_id,customer,amount',
        ...Array.from(
          { length: 3000 },
          (_, i) => `ORD-${8899 + i},VIP-9910-${i},${(i + 1) * 100}`,
        ),
      ].join('\n');
      expect(largeCsv.length).toBeGreaterThan(
        ORCHESTRATION_CONSTANTS.DIRECT_TO_DISK_CHAR_THRESHOLD,
      );

      mockExternalCallTool.mockResolvedValueOnce({
        content: [{ type: 'text', text: largeCsv }],
        isError: false,
      });

      const artifactTurn = triggerTurn + 1;
      const artifactUser = await messageSink.addUserMessage({
        conversationId: CONV_ID,
        text: `Turn ${artifactTurn}: Xuất CSV lớn và kiểm tra dòng đầu.`,
      });
      eligibleMessageIds.push(artifactUser.id);

      let capturedArtifactFilename = '';
      mockGenerateStructured.mockResolvedValueOnce({
        action: 'plan',
        steps: [
          {
            agent: 'crm_export',
            task: 'Xuất CSV và đọc dòng đầu tiên qua read_conversation_artifact',
            mustExecute: true,
          },
        ],
      });

      mockSendMessage
        .mockResolvedValueOnce({
          text: '',
          toolCalls: [{ id: 'tc-1', name: 'export_large_csv', args: {} }],
        })
        .mockImplementationOnce(
          async (toolResults: Array<{ name: string; content: string }>) => {
            const envelope = JSON.parse(toolResults[0].content);
            expect(envelope.status).toBe(CONV_ARTIFACT_STATUS);
            capturedArtifactFilename = envelope.filename;
            return {
              text: '',
              toolCalls: [
                {
                  id: 'tc-2',
                  name: CONV_ARTIFACT_READ_TOOL_NAME,
                  args: {
                    filename: capturedArtifactFilename,
                    offsetChars: 0,
                    limitChars: 120,
                  },
                },
              ],
            };
          },
        )
        .mockImplementationOnce(
          async (toolResults: Array<{ name: string; content: string }>) => {
            const payload = JSON.parse(toolResults[0].content);
            expect(payload.content).toContain('ORD-8899,VIP-9910-0,100');
            return {
              text: `Đã đọc từ artifact ${capturedArtifactFilename}: ORD-8899,VIP-9910-0,100`,
              toolCalls: [],
            };
          },
        );

      mockGenerateStructured.mockResolvedValueOnce({
        action: 'respond',
        answer: `Turn ${artifactTurn} xong: đã xuất CSV và đối chiếu ORD-8899.`,
      });

      const artifactAns = await turnResolver.resolveAnswer(
        buildJobData(
          `Turn ${artifactTurn}: Xuất CSV lớn và kiểm tra dòng đầu.`,
          artifactUser.id,
        ),
        randomUUID(),
      );
      expect(artifactAns.content).toContain('ORD-8899');

      // ReAct nhận Summary 1 trong systemInstruction
      const reactChatCall = mockStartChat.mock.calls.find(
        (call) =>
          typeof call[0]?.systemInstruction === 'string' &&
          call[0].systemInstruction.includes(CONVERSATION_SUMMARY_SECTION_HEADER),
      );
      expect(reactChatCall?.[0].systemInstruction).toContain('VIP-9910');

      const artifactAi = await messageSink.createMessage({
        channelId: CONV_ID,
        senderId: 'bot-1',
        content: artifactAns.content,
      });
      eligibleMessageIds.push(artifactAi.id);

      // === Turns 14..19: Tích lũy thêm 12 tin -> tổng pending sau Summary 1 (#11..#38) = 28 > 22 -> Rolling Compaction lần 2 ===
      for (let turn = artifactTurn + 1; turn <= 19; turn++) {
        await recordTurnToDb(
          `Turn ${turn}: Kiểm tra đối soát đợt ${turn}.`,
          `Đáp turn ${turn}: hoàn tất đối soát đợt ${turn}.`,
        );
      }
      expect(eligibleMessageIds).toHaveLength(38);

      const SUMMARY_2 = [
        '[QUY TẮC & RÀNG BUỘC CÒN HIỆU LỰC]',
        '- Khách hàng VIP-9910, mã đơn ORD-8899 luôn phải được gắn.',
        '[VIỆC ĐÃ HOÀN THÀNH]',
        '- Rà soát các lượt đầu, xuất CSV ORD-8899 và đối soát nhiều đợt.',
        '[VIỆC ĐANG LÀM DỞ / CÂU HỎI ĐANG MỞ]',
        '- Sẵn sàng trả lời câu hỏi tổng kết ở turn 20.',
      ].join('\n');

      const sendCountBeforeCompact2 = mockSendMessage.mock.calls.length;
      mockSendMessage.mockResolvedValueOnce({
        text: SUMMARY_2,
        toolCalls: [],
      });
      await compactionService.compactConversation(CONV_ID, 'gemini-2.5-flash');

      expect(mockSendMessage.mock.calls.length).toBe(
        sendCountBeforeCompact2 + 1,
      );
      const compactPrompt2 = mockSendMessage.mock.calls[
        sendCountBeforeCompact2
      ][0] as string;
      // Rolling compaction phải đưa Summary 1 + đoạn #11..#24, KHÔNG đọc lại #1..#10 và không chứa #25..#38
      expect(compactPrompt2).toContain('Khách hàng VIP-9910');
      expect(compactPrompt2).toContain(`Đáp turn ${triggerTurn} xong.`);
      expect(compactPrompt2).not.toContain('HEAD_PG2_');
      expect(compactPrompt2).not.toContain('Đáp turn 19');

      const convRowAfter2 = await prisma.conversation.findUnique({
        where: { id: CONV_ID },
        select: { metadata: true },
      });
      const compactionJson2 = asJsonObject(
        asJsonObject(convRowAfter2?.metadata)?.compaction,
      );
      expect(compactionJson2?.summary).toBe(SUMMARY_2);
      // 28 pending (#11..#38) - 14 giữ lại = 14 compacted -> dừng tại msg #24 (eligibleMessageIds[23])
      expect(compactionJson2?.summarizedUntilMessageId).toBe(
        eligibleMessageIds[23],
      );

      // === Turn 20: Chi tiết CABINET-Z91 ở Turn 3 KHÔNG có trong Summary 2 & ngoài 14 tin cuối -> Supervisor giao agent `native` gọi thật search_conversation_history trên PostgreSQL ===
      const turn20Question =
        'Turn 20: Nhắc lại mã khách, mã đơn và mã tủ hồ sơ mật ghi ở lượt 3?';
      const turn20User = await messageSink.addUserMessage({
        conversationId: CONV_ID,
        text: turn20Question,
      });
      eligibleMessageIds.push(turn20User.id);

      const generateCountBeforeTurn20 = mockGenerateStructured.mock.calls.length;
      const startChatCountBeforeTurn20 = mockStartChat.mock.calls.length;
      mockGenerateStructured.mockResolvedValueOnce({
        action: 'plan',
        steps: [
          {
            agent: NATIVE_TOOL_PROVIDER,
            task: 'Tra cứu lại mã tủ hồ sơ mật trong lịch sử hội thoại cũ',
            mustExecute: true,
          },
        ],
      });

      mockSendMessage
        .mockResolvedValueOnce({
          text: '',
          toolCalls: [
            {
              id: 'tc-hist-1',
              name: HISTORY_SEARCH_TOOL_NAME,
              args: { query: 'CABINET-Z91' },
            },
          ],
        })
        .mockImplementationOnce(
          async (toolResults: Array<{ name: string; content: string }>) => {
            expect(toolResults[0].content).toContain('"mode"');
            const found = JSON.parse(toolResults[0].content);
            expect(found.mode).toBe('search');
            expect(found.totalMatches).toBeGreaterThanOrEqual(1);
            expect(JSON.stringify(found.items)).toContain('CABINET-Z91');
            const matchedMessageId = found.items[0].messageId as string;
            return {
              text: '',
              toolCalls: [
                {
                  id: 'tc-hist-2',
                  name: HISTORY_SEARCH_TOOL_NAME,
                  args: { aroundMessageId: matchedMessageId, contextWindow: 1 },
                },
              ],
            };
          },
        )
        .mockImplementationOnce(
          async (toolResults: Array<{ name: string; content: string }>) => {
            expect(toolResults[0].content).toContain('"around"');
            const around = JSON.parse(toolResults[0].content);
            expect(around.mode).toBe('around');
            expect(around.items.length).toBeGreaterThanOrEqual(2);
            expect(JSON.stringify(around.items)).toContain('CABINET-Z91');
            return {
              text: 'Mã khách là VIP-9910, mã đơn là ORD-8899 và mã tủ hồ sơ mật ở lượt 3 là CABINET-Z91.',
              toolCalls: [],
            };
          },
        );

      const turn20Ans = await turnResolver.resolveAnswer(
        buildJobData(turn20Question, turn20User.id),
        randomUUID(),
      );
      expect(turn20Ans.content).toContain('VIP-9910');
      expect(turn20Ans.content).toContain('ORD-8899');
      expect(turn20Ans.content).toContain('CABINET-Z91');

      const turn20ReactSystem = mockStartChat.mock.calls[
        startChatCountBeforeTurn20
      ][0].systemInstruction as string;
      expect(turn20ReactSystem).toContain(CONVERSATION_SUMMARY_SECTION_HEADER);
      expect(turn20ReactSystem).toContain('VIP-9910');
      expect(turn20ReactSystem).toContain('ORD-8899');

      const turn20Call = mockGenerateStructured.mock.calls[
        generateCountBeforeTurn20
      ][0];
      const turn20Prompt = turn20Call.prompt as string;
      const turn20System = turn20Call.systemInstruction as string;
      expect(turn20System).toContain(NATIVE_TOOL_PROVIDER);
      expect(turn20Prompt).toContain(CONVERSATION_SUMMARY_SECTION_HEADER);
      expect(turn20Prompt).toContain('VIP-9910');
      expect(turn20Prompt).toContain('ORD-8899');
      expect(turn20Prompt).toContain('đối soát đợt 19');
      expect(turn20Prompt).not.toContain('HEAD_PG2_');
      expect(turn20Prompt).not.toContain('CABINET-Z91');
      expect(turn20Prompt).not.toContain('⏸️ Cần bạn duyệt');
      },
      20_000,
    );
  },
);
