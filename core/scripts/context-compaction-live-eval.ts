/**
 * Đánh giá trực tiếp (Type 2 — Real PostgreSQL + Real OpenAI LLM) luồng:
 * 12 lượt hội thoại liên tục -> Rolling Compaction 2 lần -> Context Editing ->
 * Hỏi lại thông tin ở turn đầu tiên sau khi dữ liệu cũ đã bị nén ra khỏi cửa sổ recentTurns.
 *
 * Chạy: `pnpm --filter @agent/core exec ts-node -r tsconfig-paths/register scripts/context-compaction-live-eval.ts`
 * Yêu cầu: PostgreSQL đang chạy (DATABASE_URL) và có OPENAI_API_KEY trong .env / core/.env.
 */
import { config as loadEnv } from 'dotenv';

loadEnv({ quiet: true, path: ['.env', '../.env'] });

import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { Test, TestingModule } from '@nestjs/testing';
import {
  CONV_ARTIFACT_DIR_NAME,
  NATIVE_TOOL_PROVIDER,
  ORCHESTRATION_CONSTANTS,
} from '@agent/core/constants';
import { IProcessAiTriggerJobData } from '@agent/core/infrastructure/queue';
import {
  resolveDataCharBudget,
  resolveHistoryCharBudget,
  resolveMemoryCharBudget,
} from '../src/common/text/token-budget.util';
import { CONVERSATION_COMPACTION_REPOSITORY } from '../src/contracts/memory/conversation-compaction.interface';
import { CONVERSATION_ARTIFACT_STORE } from '../src/contracts/storage/conversation-artifact.interface';
import {
  CallToolRequestDto,
  CallToolResponseDto,
} from '../src/contracts/dtos/mcp.dto';
import {
  EXECUTION_ENGINE_REGISTRY,
  EXECUTION_ROUTER,
  IToolProvider,
  MESSAGE_SINK,
  STREAM_SINK,
  TOOL_PROVIDER,
  ToolContext,
} from '../src/contracts';
import { PrismaService } from '../src/infrastructure/database/prisma.service';
import { PrismaConversationCompactionRepository } from '../src/infrastructure/database/adapters/prisma-conversation-compaction.repository';
import { PrismaMessageSink } from '../src/infrastructure/database/adapters/prisma-message-sink';
import { LocalConversationArtifactStore } from '../src/infrastructure/storage/local-conversation-artifact.store';
import { NativeToolRegistryService } from '../src/infrastructure/tools/native/native-tool-registry.service';
import { ReadConversationArtifactTool } from '../src/infrastructure/tools/native/read-conversation-artifact.tool';
import { McpToolConnectorService } from '../src/infrastructure/tools/mcp/mcp-tool-connector.service';
import { McpAuthClientService } from '../src/infrastructure/tools/mcp/mcp-auth-client.service';
import { DynamicProviderService } from '../src/infrastructure/tools/dynamic/dynamic-provider.service';
import { CircuitBreakerService } from '../src/infrastructure/resilience/circuit-breaker.service';
import { MetricsRegistryService } from '../src/infrastructure/resilience/metrics-registry.service';
import { MemoryManagerService } from '../src/memory/memory-manager.service';
import { AgentCancellationService } from '../src/engine/cancellation/agent-cancellation.service';
import { ApprovalContinuationPlannerService } from '../src/engine/hitl/approval-continuation-planner.service';
import { CheckpointPauseService } from '../src/engine/hitl/checkpoint-pause.service';
import { ReactLoopService } from '../src/engine/loop/react-loop.service';
import { AnthropicStrategy } from '../src/engine/strategy/anthropic/anthropic.strategy';
import { DeepSeekStrategy } from '../src/engine/strategy/deepseek/deepseek.strategy';
import { GeminiStrategy } from '../src/engine/strategy/gemini/gemini.strategy';
import { LlmStrategyFactory } from '../src/engine/strategy/llm-strategy.factory';
import { MockStrategy } from '../src/engine/strategy/mock/mock.strategy';
import { OpenAiStrategy } from '../src/engine/strategy/openai/openai.strategy';
import { AgentStreamService } from '../src/engine/streaming/agent-stream.service';
import { MessageClientService } from '../src/engine/streaming/message-client.service';
import { AgentRankingService } from '../src/engine/supervisor/agent-ranking.service';
import { SupervisorPromptBuilder } from '../src/engine/supervisor/supervisor-prompt.builder';
import { SupervisorService } from '../src/engine/supervisor/supervisor.service';
import { AutonomousEngine } from '../src/engine/orchestrator/engines/autonomous.engine';
import { ExecutionEngineRegistryService } from '../src/engine/orchestrator/engines/execution-engine-registry.service';
import { SmartExecutionRouter } from '../src/engine/orchestrator/engines/smart-execution-router.service';
import { TurnResolverService } from '../src/engine/orchestrator/turn/turn-resolver.service';
import { ConversationCompactionService } from '../src/engine/orchestrator/context/conversation-compaction.service';

const EVAL_MODEL = 'gpt-4o-mini';

function assertCondition(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`[LIVE EVAL ASSERTION FAILED] ${message}`);
  }
}

async function runLiveEval(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    throw new Error('Thiếu DATABASE_URL để kết nối PostgreSQL.');
  }
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('Thiếu OPENAI_API_KEY để chạy live eval OpenAI.');
  }

  const prevEnv = {
    mode: process.env.DEFAULT_ORCHESTRATION_MODE,
    reactModel: process.env.DEFAULT_REACT_MODEL,
    supModel: process.env.SUPERVISOR_MODEL,
    planModel: process.env.SUPERVISOR_PLANNING_MODEL,
    evalModel: process.env.SUPERVISOR_EVALUATE_MODEL,
  };

  process.env.DEFAULT_ORCHESTRATION_MODE = 'supervisor';
  process.env.DEFAULT_REACT_MODEL = EVAL_MODEL;
  process.env.SUPERVISOR_MODEL = EVAL_MODEL;
  process.env.SUPERVISOR_PLANNING_MODEL = EVAL_MODEL;
  process.env.SUPERVISOR_EVALUATE_MODEL = EVAL_MODEL;

  const convId = randomUUID();
  const userId = '00000000-0000-7000-8000-000000000001';

  const artifactStore = new LocalConversationArtifactStore();
  const nativeRegistry = new NativeToolRegistryService();
  const readArtifactTool = new ReadConversationArtifactTool(
    artifactStore,
    nativeRegistry,
  );
  readArtifactTool.onModuleInit();

  const toolProvider: IToolProvider = {
    getTools: async (provider: string) =>
      provider === NATIVE_TOOL_PROVIDER ? nativeRegistry.getAllTools() : [],
    callTool: async (
      dto: CallToolRequestDto,
      signal?: AbortSignal,
      context?: ToolContext,
    ): Promise<CallToolResponseDto> => {
      if (nativeRegistry.hasTool(dto.name)) {
        return nativeRegistry.executeFromRequest(dto, context, signal);
      }
      return { content: [{ type: 'text', text: '' }], isError: false };
    },
  };

  const moduleRef: TestingModule = await Test.createTestingModule({
    providers: [
      PrismaService,
      PrismaMessageSink,
      PrismaConversationCompactionRepository,
      GeminiStrategy,
      OpenAiStrategy,
      AnthropicStrategy,
      DeepSeekStrategy,
      MockStrategy,
      LlmStrategyFactory,
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
      { provide: TOOL_PROVIDER, useValue: toolProvider },
      { provide: McpToolConnectorService, useValue: toolProvider },
      {
        provide: McpAuthClientService,
        useValue: { getConnectionStatus: async () => [] },
      },
      {
        provide: DynamicProviderService,
        useValue: { getProvidersByUser: async () => [] },
      },
      {
        provide: CircuitBreakerService,
        useValue: { run: async <T>(_k: string, fn: () => Promise<T>) => fn() },
      },
      {
        provide: MetricsRegistryService,
        useValue: { incrementBehaviorSignal: () => undefined },
      },
      {
        provide: AgentCancellationService,
        useValue: { isCancelled: async () => false },
      },
      {
        provide: CheckpointPauseService,
        useValue: {
          pauseForApproval: async () => undefined,
          pauseForClarification: async () => undefined,
        },
      },
      {
        provide: ApprovalContinuationPlannerService,
        useValue: { resolveRemainingSteps: async () => undefined },
      },
      {
        provide: AgentRankingService,
        useValue: {
          rankAgentsForPrompt: async (_p: string, a: unknown[]) => ({
            shown: a,
            omittedCount: 0,
          }),
          findAmbiguousAgentCluster: () => null,
        },
      },
      {
        provide: MemoryManagerService,
        useValue: {
          buildBudget: (modelId: string) => ({
            toolResultCharBudget: resolveDataCharBudget(modelId),
            memoryCharBudget: resolveMemoryCharBudget(modelId),
            historyCharBudget: resolveHistoryCharBudget(modelId),
          }),
          getMemories: async () => [],
          recordUserDeclaredFact: async () => undefined,
        },
      },
    ],
  }).compile();

  await moduleRef.init();
  const prisma = moduleRef.get(PrismaService);
  const messageSink = moduleRef.get(PrismaMessageSink);
  const compactionRepo = moduleRef.get(PrismaConversationCompactionRepository);
  const compactionService = moduleRef.get(ConversationCompactionService);
  const turnResolver = moduleRef.get(TurnResolverService);

  const prompts: string[] = [
    'Turn 1: Quy tắc cố định cho toàn bộ phiên này: mọi báo cáo đều phải gắn mã khách VIP-9910, mã đơn ORD-8899 và hạn mức ngân sách 150 triệu VND. Hãy xác nhận ngắn gọn.',
    'Turn 2: Viết giúp tôi một danh sách kiểm tra chi tiết (khoảng 1600 ký tự, gồm 6 bước đánh số) để chuẩn bị kiểm kê cuối quý.',
    'Turn 3: Cảm ơn, hãy nhắc lại ngắn gọn bước 1 và bước 2 ở dạng 2 gạch đầu dòng.',
    'Turn 4: Bổ sung quy tắc cố định: người phụ trách phê duyệt cuối cùng là chị Minh Anh (Phòng Tài chính). Xác nhận ngắn gọn nhé.',
    'Turn 5: Nhắc ngắn gọn vai trò của Phòng Tài chính trong bước phê duyệt là gì?',
    'Turn 6: Chốt ngắn gọn các hạng mục cần rà soát trước khi sang công đoạn vận hành kho.',
    'Turn 7: Hỏi riêng công việc kho: ở kho A3 nên sắp xếp kệ hàng dễ vỡ ở tầng thấp hay tầng cao? Trả lời 1 câu.',
    'Turn 8: Lịch xe giao hàng Thứ Năm nên ưu tiên tuyến nội thành trước đúng không? Trả lời 1 câu.',
    'Turn 9: Khi in tem nhãn mã vạch bị mờ đầu in thì vệ sinh bằng gì? Trả lời 1 câu.',
    'Turn 10: Ca trực bảo vệ cuối tuần có cần bàn giao sổ niêm phong không? Trả lời 1 câu.',
    'Turn 11: Mẫu biên bản bàn giao ca trực cần mấy chữ ký tối thiểu? Trả lời 1 câu.',
  ];

  const eligibleMessageIds: string[] = [];
  let compactionCount = 0;

  try {
    console.log(`\n=== BẮT ĐẦU LIVE EVAL (convId=${convId}, model=${EVAL_MODEL}) ===\n`);

    for (let i = 0; i < prompts.length; i++) {
      const turnNumber = i + 1;
      const prompt = prompts[i];
      const userCreated = await messageSink.addUserMessage({
        conversationId: convId,
        text: prompt,
      });
      eligibleMessageIds.push(userCreated.id);

      const jobData: IProcessAiTriggerJobData = {
        userId,
        channelId: convId,
        conversationId: convId,
        workspaceId: 'default',
        messageId: userCreated.id,
        prompt,
        botUserId: 'bot-1',
        channelType: 'web',
      };

      const answer = await turnResolver.resolveAnswer(jobData, randomUUID());
      let aiText = answer.content;
      if (
        turnNumber === 2 &&
        aiText.length <= ORCHESTRATION_CONSTANTS.CONTEXT_EDIT_AI_TEXT_MAX_CHARS
      ) {
        aiText = `${aiText}\n${'[Phụ lục chi tiết kiểm kê] '.repeat(60)}_TAIL_CHECKLIST`;
      }

      const aiCreated = await messageSink.createMessage({
        channelId: convId,
        senderId: 'bot-1',
        content: aiText,
      });
      eligibleMessageIds.push(aiCreated.id);

      console.log(
        `[Turn ${turnNumber}] User (${prompt.slice(0, 58)}...) -> AI (${aiText.length} chars)`,
      );

      const prevState = await compactionRepo.getCompactionState(convId);
      await compactionService.compactConversation(convId, EVAL_MODEL);
      const nextState = await compactionRepo.getCompactionState(convId);

      if (
        nextState &&
        nextState.summarizedUntilMessageId !== prevState?.summarizedUntilMessageId
      ) {
        compactionCount += 1;
        console.log(
          `\n--- [COMPACTION #${compactionCount} PERSISTED IN POSTGRES] (until=${nextState.summarizedUntilMessageId}) ---`,
        );
        console.log(nextState.summary);
        console.log('--- END COMPACTION SUMMARY ---\n');
      }
    }

    assertCondition(
      compactionCount === 2,
      `Kỳ vọng đúng 2 lần compaction sau 11 turn (22 tin), thực tế=${compactionCount}`,
    );

    // Kiểm tra cửa sổ recentTurns thực sự không còn chứa các thông tin turn 1 & turn 4
    const finalContext = await compactionService.loadEffectiveContext(
      convId,
      EVAL_MODEL,
    );
    const recentCombined = finalContext.recentTurns.map((t) => t.text).join('\n');
    assertCondition(
      Boolean(finalContext.summary),
      'Conversation.metadata.compaction.summary bị rỗng ở Turn 12',
    );
    assertCondition(
      finalContext.recentTurns.length >=
        ORCHESTRATION_CONSTANTS.COMPACTION_KEEP_RECENT_TURNS &&
        finalContext.recentTurns.length <=
          ORCHESTRATION_CONSTANTS.COMPACTION_TRIGGER_TURNS,
      `Kỳ vọng recentTurns nằm trong [${ORCHESTRATION_CONSTANTS.COMPACTION_KEEP_RECENT_TURNS}..${ORCHESTRATION_CONSTANTS.COMPACTION_TRIGGER_TURNS}], thực tế=${finalContext.recentTurns.length}`,
    );
    assertCondition(
      !recentCombined.includes('VIP-9910') && !recentCombined.includes('Minh Anh'),
      'Cửa sổ recentTurns vẫn còn chứa dữ liệu cũ của turn 1/4, chưa cô lập bài test',
    );

    // === Turn 12: Live OpenAI Recall Question ===
    const recallPrompt =
      'Câu hỏi kiểm tra trí nhớ: Hãy liệt kê đầy đủ 4 thông tin cố định đã thống nhất từ các lượt đầu tiên: (1) mã khách hàng, (2) mã đơn hàng, (3) hạn mức ngân sách, (4) họ tên người phê duyệt cuối cùng.';
    const turn12User = await messageSink.addUserMessage({
      conversationId: convId,
      text: recallPrompt,
    });
    const turn12Ans = await turnResolver.resolveAnswer(
      {
        userId,
        channelId: convId,
        conversationId: convId,
        workspaceId: 'default',
        messageId: turn12User.id,
        prompt: recallPrompt,
        botUserId: 'bot-1',
        channelType: 'web',
      },
      randomUUID(),
    );

    console.log(
      `\n=== [TURN 12 LIVE OPENAI RECALL ANSWER] (recentTurns=${finalContext.recentTurns.length}) ===`,
    );
    console.log(turn12Ans.content);
    console.log('====================================================\n');

    const normalized = turn12Ans.content.toLowerCase();
    assertCondition(
      normalized.includes('vip-9910'),
      `Turn 12 thiếu mã khách VIP-9910: ${turn12Ans.content}`,
    );
    assertCondition(
      normalized.includes('ord-8899'),
      `Turn 12 thiếu mã đơn ORD-8899: ${turn12Ans.content}`,
    );
    assertCondition(
      normalized.includes('150'),
      `Turn 12 thiếu hạn mức 150 triệu: ${turn12Ans.content}`,
    );
    assertCondition(
      normalized.includes('minh anh'),
      `Turn 12 thiếu người phê duyệt Minh Anh: ${turn12Ans.content}`,
    );

    console.log('✅ LIVE EVAL PASSED: Real PostgreSQL + Real OpenAI 12-turn + 2-round Rolling Compaction recalled all 4 facts!');
  } finally {
    if (prevEnv.mode === undefined) delete process.env.DEFAULT_ORCHESTRATION_MODE;
    else process.env.DEFAULT_ORCHESTRATION_MODE = prevEnv.mode;
    if (prevEnv.reactModel === undefined) delete process.env.DEFAULT_REACT_MODEL;
    else process.env.DEFAULT_REACT_MODEL = prevEnv.reactModel;
    if (prevEnv.supModel === undefined) delete process.env.SUPERVISOR_MODEL;
    else process.env.SUPERVISOR_MODEL = prevEnv.supModel;
    if (prevEnv.planModel === undefined) delete process.env.SUPERVISOR_PLANNING_MODEL;
    else process.env.SUPERVISOR_PLANNING_MODEL = prevEnv.planModel;
    if (prevEnv.evalModel === undefined) delete process.env.SUPERVISOR_EVALUATE_MODEL;
    else process.env.SUPERVISOR_EVALUATE_MODEL = prevEnv.evalModel;

    artifactStore.onModuleDestroy();
    await fs.rm(path.join(os.tmpdir(), CONV_ARTIFACT_DIR_NAME, convId), {
      recursive: true,
      force: true,
    });
    await prisma.conversationMessage.deleteMany({
      where: { conversationId: convId },
    });
    await prisma.conversation.deleteMany({
      where: { id: convId },
    });
    await moduleRef.close();
  }
}

void runLiveEval().catch((err) => {
  console.error('❌ LIVE EVAL FAILED:', err);
  process.exit(1);
});
