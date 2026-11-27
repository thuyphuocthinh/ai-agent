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
import { PrismaMessageSink } from '../../../infrastructure/database/adapters/prisma-message-sink';
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

// Chạy thật với PostgreSQL (PrismaService + PrismaMessageSink + PrismaConversationCompactionRepository).
// Đặt SKIP_POSTGRES_TESTS=1 để bỏ qua khi không có DB local.
const describeWithPostgres =
  process.env.SKIP_POSTGRES_TESTS || !process.env.DATABASE_URL
    ? describe.skip
    : describe;

describeWithPostgres(
  'Multi-turn PostgreSQL Integration (Type 1): 12 turns + 2-round Rolling Compaction + Context Editing + Artifact Handoff',
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
        startChat: mockStartChat,
        generateStructured: mockGenerateStructured,
      };

      moduleRef = await Test.createTestingModule({
        providers: [
          PrismaService,
          PrismaMessageSink,
          PrismaConversationCompactionRepository,
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
          { provide: MESSAGE_SINK, useExisting: PrismaMessageSink },
          { provide: MessageClientService, useExisting: PrismaMessageSink },
          { provide: CONVERSATION_ARTIFACT_STORE, useValue: artifactStore },
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

    it('persists 12 turns into PostgreSQL, executes 2 rolling compactions, filters pause banners, applies Context Editing, hands off artifacts, and recalls Turn 1 rules at Turn 12', async () => {
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

      // === Turns 1..5 (10 eligible DB messages -> chưa vượt COMPACTION_TRIGGER_TURNS = 10) ===
      for (let turn = 1; turn <= 5; turn++) {
        const userPrompt =
          turn === 1
            ? 'Quy tắc cố định: luôn gắn mã khách VIP-9910 và mã đơn ORD-8899.'
            : `Câu hỏi turn ${turn}: Kiểm tra trạng thái mục ${turn}.`;
        const aiText =
          turn === 2
            ? `HEAD_PG2_${'A'.repeat(2400)}_TAIL_PG2`
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
      ).toBe(11); // 10 eligible + 1 banner pause
      expect(await compactionRepo.getCompactionState(CONV_ID)).toBeNull();
      expect(mockSendMessage).not.toHaveBeenCalled();

      // === Turn 6 (đủ 12 eligible DB messages > 10): Supervisor đọc Context Edited turn 2 + Compaction lần 1 ===
      const turn6User = await messageSink.addUserMessage({
        conversationId: CONV_ID,
        text: 'Turn 6: Tiếp tục tổng hợp tình hình.',
      });
      eligibleMessageIds.push(turn6User.id);

      mockGenerateStructured.mockResolvedValueOnce({
        action: 'respond',
        answer: 'Đáp turn 6 xong.',
      });
      const turn6Ans = await turnResolver.resolveAnswer(
        buildJobData('Turn 6: Tiếp tục tổng hợp tình hình.', turn6User.id),
        randomUUID(),
      );
      expect(turn6Ans.content).toBe('Đáp turn 6 xong.');

      const turn6PlanPrompt = mockGenerateStructured.mock.calls[5][0]
        .prompt as string;
      expect(turn6PlanPrompt).toContain(CONTEXT_EDITED_HISTORY_SECTION_HEADER);
      expect(turn6PlanPrompt).toContain('HEAD_PG2_');
      expect(turn6PlanPrompt).toContain('TAIL_PG2');
      expect(turn6PlanPrompt).toContain('đã lược bỏ');
      expect(turn6PlanPrompt).not.toContain('⏸️ Cần bạn duyệt');

      const turn6Ai = await messageSink.createMessage({
        channelId: CONV_ID,
        senderId: 'bot-1',
        content: turn6Ans.content,
      });
      eligibleMessageIds.push(turn6Ai.id);

      const SUMMARY_1 = [
        '[QUY TẮC & RÀNG BUỘC CÒN HIỆU LỰC]',
        '- Khách hàng VIP-9910, mã đơn ORD-8899 bắt buộc gắn vào mọi báo cáo.',
        '[VIỆC ĐÃ HOÀN THÀNH]',
        '- Hoàn tất rà soát các mục turn 1..3.',
        '[VIỆC ĐANG LÀM DỞ / CÂU HỎI ĐANG MỞ]',
        '- Chuẩn bị xuất báo cáo CSV.',
      ].join('\n');

      mockSendMessage.mockResolvedValueOnce({
        text: SUMMARY_1,
        toolCalls: [],
      });
      await compactionService.compactConversation(CONV_ID, 'gemini-2.5-flash');

      // Kiểm tra trực tiếp row Conversation.metadata trong PostgreSQL
      const convRowAfter1 = await prisma.conversation.findUnique({
        where: { id: CONV_ID },
        select: { metadata: true },
      });
      const compactionJson1 = asJsonObject(
        asJsonObject(convRowAfter1?.metadata)?.compaction,
      );
      expect(compactionJson1).toBeTruthy();
      expect(compactionJson1?.summary).toBe(SUMMARY_1);
      // 12 eligible - 6 giữ lại = 6 compacted -> cursor dừng đúng tại msg #6 (eligibleMessageIds[5])
      expect(compactionJson1?.summarizedUntilMessageId).toBe(
        eligibleMessageIds[5],
      );

      // Prompt compaction #1 chỉ gồm #1..#6 (không chứa #7..#12 như 'Đáp turn 6 xong.')
      const compactPrompt1 = mockSendMessage.mock.calls[0][0] as string;
      expect(compactPrompt1).toContain('VIP-9910');
      expect(compactPrompt1).toContain('ORD-8899');
      expect(compactPrompt1).toContain('HEAD_PG2_');
      expect(compactPrompt1).not.toContain('Đáp turn 6 xong.');
      expect(compactPrompt1).not.toContain('⏸️ Cần bạn duyệt');
      expect(mockStartChat).toHaveBeenCalledWith(
        expect.objectContaining({ systemInstruction: COMPACTION_SYSTEM_PROMPT }),
      );

      // === Turn 7: Offload CSV >50KB sang artifact + đọc cắt lát thật, đồng thời Supervisor & ReAct đều nhận Summary 1 ===
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

      const turn7User = await messageSink.addUserMessage({
        conversationId: CONV_ID,
        text: 'Turn 7: Xuất CSV lớn và kiểm tra dòng đầu.',
      });
      eligibleMessageIds.push(turn7User.id);

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
        answer: 'Turn 7 xong: đã xuất CSV và đối chiếu ORD-8899.',
      });

      const turn7Ans = await turnResolver.resolveAnswer(
        buildJobData('Turn 7: Xuất CSV lớn và kiểm tra dòng đầu.', turn7User.id),
        randomUUID(),
      );
      expect(turn7Ans.content).toContain('ORD-8899');

      // ReAct nhận Summary 1 trong systemInstruction
      const reactChatCall = mockStartChat.mock.calls.find(
        (call) =>
          typeof call[0]?.systemInstruction === 'string' &&
          call[0].systemInstruction.includes(CONVERSATION_SUMMARY_SECTION_HEADER),
      );
      expect(reactChatCall?.[0].systemInstruction).toContain('VIP-9910');

      const turn7Ai = await messageSink.createMessage({
        channelId: CONV_ID,
        senderId: 'bot-1',
        content: turn7Ans.content,
      });
      eligibleMessageIds.push(turn7Ai.id);

      // === Turns 8..11: Tích lũy thêm 8 tin -> tổng pending sau Summary 1 = 16 > 10 -> Rolling Compaction lần 2 ===
      for (let turn = 8; turn <= 11; turn++) {
        await recordTurnToDb(
          `Turn ${turn}: Kiểm tra đối soát đợt ${turn}.`,
          `Đáp turn ${turn}: hoàn tất đối soát đợt ${turn}.`,
        );
      }
      // Giờ eligibleMessageIds có 22 tin (Turns 1..11 = 22). Sau msg #6 (index 5) đang có #7..#22 (16 tin > 10).
      expect(eligibleMessageIds).toHaveLength(22);

      const SUMMARY_2 = [
        '[QUY TẮC & RÀNG BUỘC CÒN HIỆU LỰC]',
        '- Khách hàng VIP-9910, mã đơn ORD-8899 luôn phải được gắn.',
        '[VIỆC ĐÃ HOÀN THÀNH]',
        '- Rà soát turn 1..6, xuất CSV ORD-8899 ở turn 7 và đối soát đợt 8.',
        '[VIỆC ĐANG LÀM DỞ / CÂU HỎI ĐANG MỞ]',
        '- Sẵn sàng trả lời câu hỏi tổng kết ở turn 12.',
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
      // Rolling compaction phải đưa Summary 1 + đoạn #7..#16, KHÔNG đọc lại #1..#6
      expect(compactPrompt2).toContain('Khách hàng VIP-9910');
      expect(compactPrompt2).toContain('Đáp turn 6 xong.');
      expect(compactPrompt2).not.toContain('HEAD_PG2_');
      expect(compactPrompt2).not.toContain('Đáp turn 11');

      const convRowAfter2 = await prisma.conversation.findUnique({
        where: { id: CONV_ID },
        select: { metadata: true },
      });
      const compactionJson2 = asJsonObject(
        asJsonObject(convRowAfter2?.metadata)?.compaction,
      );
      expect(compactionJson2?.summary).toBe(SUMMARY_2);
      // 16 pending (#7..#22) - 6 giữ lại = 10 compacted -> dừng tại msg #16 (eligibleMessageIds[15])
      expect(compactionJson2?.summarizedUntilMessageId).toBe(
        eligibleMessageIds[15],
      );

      // === Turn 12: Hỏi lại quy tắc Turn 1 sau 2 lần compact (chỉ còn Summary 2 + 6 tin cuối #17..#22) ===
      const turn12Question =
        'Turn 12: Nhắc lại chính xác mã khách và mã đơn ở turn đầu tiên?';
      const turn12User = await messageSink.addUserMessage({
        conversationId: CONV_ID,
        text: turn12Question,
      });
      eligibleMessageIds.push(turn12User.id);

      const generateCountBeforeTurn12 = mockGenerateStructured.mock.calls.length;
      mockGenerateStructured.mockResolvedValueOnce({
        action: 'respond',
        answer: 'Mã khách là VIP-9910 và mã đơn là ORD-8899.',
      });

      const turn12Ans = await turnResolver.resolveAnswer(
        buildJobData(turn12Question, turn12User.id),
        randomUUID(),
      );
      expect(turn12Ans.content).toContain('VIP-9910');
      expect(turn12Ans.content).toContain('ORD-8899');

      const turn12Prompt = mockGenerateStructured.mock.calls[
        generateCountBeforeTurn12
      ][0].prompt as string;
      expect(turn12Prompt).toContain(CONVERSATION_SUMMARY_SECTION_HEADER);
      expect(turn12Prompt).toContain('VIP-9910');
      expect(turn12Prompt).toContain('ORD-8899');
      expect(turn12Prompt).toContain('đối soát đợt 11');
      // Các lượt cũ #1..#16 không còn nguyên văn trong prompt, chỉ nằm trong Summary 2
      expect(turn12Prompt).not.toContain('HEAD_PG2_');
      expect(turn12Prompt).not.toContain('Đáp án chi tiết turn 3');
      expect(turn12Prompt).not.toContain('⏸️ Cần bạn duyệt');
    });
  },
);
