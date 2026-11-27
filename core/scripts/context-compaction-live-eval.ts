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
import { CONVERSATION_HISTORY_SEARCH_REPOSITORY } from '../src/contracts/memory/conversation-history-search.interface';
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
import { PrismaConversationHistorySearchRepository } from '../src/infrastructure/database/adapters/prisma-conversation-history-search.repository';
import { PrismaMessageSink } from '../src/infrastructure/database/adapters/prisma-message-sink';
import { LocalConversationArtifactStore } from '../src/infrastructure/storage/local-conversation-artifact.store';
import { NativeToolRegistryService } from '../src/infrastructure/tools/native/native-tool-registry.service';
import { ReadConversationArtifactTool } from '../src/infrastructure/tools/native/read-conversation-artifact.tool';
import { SearchConversationHistoryTool } from '../src/infrastructure/tools/native/search-conversation-history.tool';
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
const DEFAULT_EVAL_TURNS = 18;

const FILLER_QUESTIONS: readonly string[] = [
  'Nhắc ngắn gọn vai trò của Phòng Tài chính trong bước phê duyệt là gì? Trả lời 1 câu.',
  'Chốt ngắn gọn 3 hạng mục cần rà soát trước khi sang công đoạn vận hành kho.',
  'Ở kho A3 nên sắp xếp kệ hàng dễ vỡ ở tầng thấp hay tầng cao? Trả lời 1 câu.',
  'Lịch xe giao hàng Thứ Năm nên ưu tiên tuyến nội thành trước đúng không? Trả lời 1 câu.',
  'Khi in tem nhãn mã vạch bị mờ đầu in thì vệ sinh bằng gì? Trả lời 1 câu.',
  'Ca trực bảo vệ cuối tuần có cần bàn giao sổ niêm phong không? Trả lời 1 câu.',
  'Mẫu biên bản bàn giao ca trực cần mấy chữ ký tối thiểu? Trả lời 1 câu.',
  'Nhiệt độ tiêu chuẩn khu vực lưu trữ hàng khô là bao nhiêu độ C? Trả lời 1 câu.',
  'Xe nâng tay cần kiểm tra áp suất bánh trước khi vận hành đúng không? Trả lời 1 câu.',
  'Quy trình đóng gói hàng cồng kềnh có bắt buộc dùng băng keo cảnh báo không? Trả lời 1 câu.',
  'Hạn nộp báo cáo tồn kho hàng tuần vào thứ mấy? Trả lời 1 câu.',
  'Khi mất điện lưới tạm thời, đèn khẩn cấp lối thoát hiểm bật tự động đúng không? Trả lời 1 câu.',
  'Bình chữa cháy CO2 trong kho cần kiểm định định kỳ mấy tháng một lần? Trả lời 1 câu.',
  'Khi nhập lô hàng mới từ nhà cung cấp, bộ phận QA cần lấy mấy mẫu kiểm tra? Trả lời 1 câu.',
  'Kho lạnh có cần ghi log nhiệt độ mỗi 4 giờ hay tự động qua cảm biến? Trả lời 1 câu.',
  'Thùng carton ẩm mốc cần cách ly sang khu vực nào trước khi lập biên bản? Trả lời 1 câu.',
  'Quy định mang giày bảo hộ áp dụng cho toàn bộ khu vực xuất nhập hàng đúng không? Trả lời 1 câu.',
  'Thời gian lưu trữ phiếu xuất kho bản cứng tại phòng lưu trữ là bao lâu? Trả lời 1 câu.',
  'Máy quét mã vạch không dây hết pin dự phòng thì sạc tại trạm nào? Trả lời 1 câu.',
  'Đơn hàng gấp hỏa tốc cần gắn nhãn màu gì bên ngoài kiện hàng? Trả lời 1 câu.',
  'Khi khách đổi trả hàng nguyên seal, kho kiểm tra ngoại quan trong bao lâu? Trả lời 1 câu.',
  'Sàn kho có cần kẻ vạch vàng phân làn cho xe nâng hàng tuần không? Trả lời 1 câu.',
  'Bao bì bọc chống sốc bọt khí nên đặt ở quầy đóng gói số mấy? Trả lời 1 câu.',
  'Chứng từ vận chuyển liên tỉnh cần đính kèm bản sao hóa đơn GTGT đúng không? Trả lời 1 câu.',
  'Cửa cuốn kho chính sau giờ làm việc phải khóa chốt phụ bên trong đúng không? Trả lời 1 câu.',
  'Danh sách hàng cận date dưới 30 ngày cần gửi báo cáo cho ai? Trả lời 1 câu.',
  'Bảng kiểm tra vệ sinh cuối ngày do tổ trưởng ca chiều ký xác nhận đúng không? Trả lời 1 câu.',
  'Thiết bị cân điện tử bàn 100kg cần hiệu chuẩn lại mỗi quý một lần đúng không? Trả lời 1 câu.',
  'Hàng dễ cháy nổ bắt buộc để tách biệt tối thiểu bao nhiêu mét với nguồn nhiệt? Trả lời 1 câu.',
  'Khi phát hiện sai lệch số lượng thực tế và phần mềm WMS thì lập phiếu gì? Trả lời 1 câu.',
  'Khu vực sạc pin xe nâng điện cần đặt cách xa thùng giấy tối thiểu bao nhiêu mét? Trả lời 1 câu.',
  'Đơn vị chuyển phát nhanh thường đến lấy hàng khung giờ nào buổi chiều? Trả lời 1 câu.',
  'Tem QR code kiểm kê tài sản cố định được dán ở góc nào của thiết bị? Trả lời 1 câu.',
  'Quy trình bàn giao chìa khóa cổng phụ giữa ca ngày và ca đêm ghi vào sổ nào? Trả lời 1 câu.',
  'Pallet gỗ bị nứt thanh chịu lực có được phép xếp lên kệ tầng 3 không? Trả lời 1 câu.',
  'Số lượng tối đa chồng thùng giấy loại A lên một pallet là mấy lớp? Trả lời 1 câu.',
  'Khi mưa lớn có nguy cơ hắt nước qua cửa xuất hàng, cần kéo rèm chắn ngay đúng không? Trả lời 1 câu.',
  'Phiếu điều chuyển nội bộ giữa kho A3 và kho B2 cần chữ ký của bên nào? Trả lời 1 câu.',
  'Hộp sơ cứu y tế tại trạm bảo vệ cần kiểm tra hạn sử dụng thuốc định kỳ hàng tháng đúng không? Trả lời 1 câu.',
  'Sau khi kết thúc đối chiếu cuối tháng, dữ liệu tồn kho phải khóa sổ trước mấy giờ? Trả lời 1 câu.',
  'Mực in ribbon cho máy in nhiệt cần bảo quản ở nơi thoáng mát tránh nắng đúng không? Trả lời 1 câu.',
  'Khi có khách tham quan vào kho bắt buộc phát áo phản quang và thẻ khách đúng không? Trả lời 1 câu.',
];

function parseTargetTurns(): number {
  const arg = process.argv.find((a) => a.startsWith('--turns='));
  if (!arg) return DEFAULT_EVAL_TURNS;
  const parsed = Number(arg.slice('--turns='.length));
  return Number.isFinite(parsed) && parsed >= 18 ? Math.floor(parsed) : DEFAULT_EVAL_TURNS;
}

function buildConversationPrompts(preRecallTurns: number): string[] {
  const list: string[] = [];
  let fillerIdx = 0;
  for (let turn = 1; turn <= preRecallTurns; turn++) {
    if (turn === 1) {
      list.push(
        'Turn 1: Quy tắc cố định cho toàn bộ phiên này: mọi báo cáo đều phải gắn mã khách VIP-9910, mã đơn ORD-8899 và hạn mức ngân sách 150 triệu VND. Hãy xác nhận ngắn gọn.',
      );
    } else if (turn === 2) {
      list.push(
        'Turn 2: Viết giúp tôi một danh sách kiểm tra chi tiết (khoảng 2200 ký tự, gồm 6 bước đánh số) để chuẩn bị kiểm kê cuối quý.',
      );
    } else if (turn === 3) {
      list.push(
        'Turn 3: Ghi chú vụn riêng bên lề không liên quan báo cáo: mã tủ khóa lưu hồ sơ giấy phòng B là CABINET-Z91, chìa khóa để ở ngăn kéo 4. Trả lời 1 câu.',
      );
    } else if (turn === 4) {
      list.push(
        'Turn 4: Bổ sung quy tắc cố định: người phụ trách phê duyệt cuối cùng là chị Minh Anh (Phòng Tài chính). Xác nhận ngắn gọn nhé.',
      );
    } else if (turn === 7 && preRecallTurns >= 25) {
      list.push(
        'Turn 7: Ghi chú phụ: xe tải giao tuyến miền Đông hôm nay mang biển số 51C-84219 do tài xế Hùng lái. Xác nhận 1 câu.',
      );
    } else if (turn === 15 && preRecallTurns >= 25) {
      list.push(
        'Turn 15: Ghi chú kỹ thuật: vừa thay đầu in cho máy in tem nhãn nhiệt mới mang số serial SN-PRN-4092. Xác nhận 1 câu.',
      );
    } else if (turn === 25 && preRecallTurns >= 30) {
      list.push(
        'Turn 25: Phân công ca trực đêm Chủ Nhật tuần này là anh Tuấn Bảo Trì (máy nhánh nội bộ ext-208). Xác nhận 1 câu.',
      );
    } else {
      const q = FILLER_QUESTIONS[fillerIdx % FILLER_QUESTIONS.length];
      fillerIdx += 1;
      list.push(`Turn ${turn}: ${q}`);
    }
  }
  return list;
}

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
  let searchToolInvocations = 0;

  const moduleRef: TestingModule = await Test.createTestingModule({
    providers: [
      PrismaService,
      PrismaMessageSink,
      PrismaConversationCompactionRepository,
      PrismaConversationHistorySearchRepository,
      NativeToolRegistryService,
      ReadConversationArtifactTool,
      SearchConversationHistoryTool,
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
          getTools: async (provider: string) =>
            provider === NATIVE_TOOL_PROVIDER ? nativeRegistry.getAllTools() : [],
          callTool: async (
            dto: CallToolRequestDto,
            signal?: AbortSignal,
            context?: ToolContext,
          ): Promise<CallToolResponseDto> => {
            if (nativeRegistry.hasTool(dto.name)) {
              const res = await nativeRegistry.executeFromRequest(dto, context, signal);
              if (dto.name === 'search_conversation_history') {
                searchToolInvocations += 1;
                const rawText = res.content?.[0]?.text ?? '';
                let meta = '';
                try {
                  const parsed = JSON.parse(rawText) as {
                    mode?: string;
                    totalMatches?: number;
                    returnedCount?: number;
                  };
                  meta = ` -> mode=${parsed.mode}, matches=${parsed.totalMatches}, returned=${parsed.returnedCount}`;
                } catch {
                  meta = ` -> rawLen=${rawText.length}`;
                }
                console.log(
                  `[LIVE TOOL CALL #${searchToolInvocations}] ${dto.name}(${JSON.stringify(dto.args)})${meta}`,
                );
              }
              return res;
            }
            return { content: [{ type: 'text', text: '' }], isError: false };
          },
        }),
        inject: [NativeToolRegistryService],
      },
      { provide: McpToolConnectorService, useExisting: TOOL_PROVIDER },
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

  const totalTargetTurns = parseTargetTurns();
  const isStressBenchmark = totalTargetTurns >= 30;
  const prompts = buildConversationPrompts(totalTargetTurns - 1);

  const eligibleMessageIds: string[] = [];
  let compactionCount = 0;
  const startedAtMs = Date.now();

  try {
    console.log(
      `\n=== BẮT ĐẦU LIVE EVAL (convId=${convId}, model=${EVAL_MODEL}, targetTurns=${totalTargetTurns}) ===\n`,
    );

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
        `[Turn ${turnNumber}/${totalTargetTurns}] User (${prompt.slice(0, 52)}...) -> AI (${aiText.length} chars)`,
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
          `\n--- [COMPACTION #${compactionCount} PERSISTED IN POSTGRES] (until=${nextState.summarizedUntilMessageId}, words=${nextState.summary.split(/\s+/).length}) ---`,
        );
        console.log(nextState.summary);
        console.log('--- END COMPACTION SUMMARY ---\n');
      }
    }

    assertCondition(
      compactionCount >= 2,
      `Kỳ vọng tối thiểu 2 lần compaction, thực tế=${compactionCount}`,
    );

    const finalContext = await compactionService.loadEffectiveContext(
      convId,
      EVAL_MODEL,
    );
    const recentCombined = finalContext.recentTurns.map((t) => t.text).join('\n');
    const summaryText = finalContext.summary ?? '';
    assertCondition(
      Boolean(summaryText),
      'Conversation.metadata.compaction.summary bị rỗng ở lượt cuối',
    );
    assertCondition(
      finalContext.recentTurns.length >=
        ORCHESTRATION_CONSTANTS.COMPACTION_KEEP_RECENT_TURNS &&
        finalContext.recentTurns.length <=
          ORCHESTRATION_CONSTANTS.COMPACTION_TRIGGER_TURNS,
      `Kỳ vọng recentTurns nằm trong [${ORCHESTRATION_CONSTANTS.COMPACTION_KEEP_RECENT_TURNS}..${ORCHESTRATION_CONSTANTS.COMPACTION_TRIGGER_TURNS}], thực tế=${finalContext.recentTurns.length}`,
    );
    assertCondition(
      !recentCombined.includes('VIP-9910') &&
        !recentCombined.includes('Minh Anh') &&
        !recentCombined.includes('CABINET-Z91') &&
        !recentCombined.includes('51C-84219') &&
        !recentCombined.includes('SN-PRN-4092') &&
        !recentCombined.includes('ext-208'),
      'Cửa sổ recentTurns vẫn còn chứa dữ liệu cũ, chưa cô lập bài test',
    );

    const recallPrompt = isStressBenchmark
      ? `Câu hỏi kiểm tra trí nhớ ở Turn ${totalTargetTurns}: Hãy tra cứu đầy đủ cả Tóm tắt lẫn lịch sử cũ (gọi search_conversation_history khi cần) để trả lời chính xác 8 thông tin từ các lượt trước: (1) mã khách hàng, (2) mã đơn hàng, (3) hạn mức ngân sách, (4) họ tên người phê duyệt cuối, (5) mã tủ khóa phòng B và ngăn kéo để chìa khóa, (6) biển số xe tải tuyến miền Đông, (7) số serial máy in tem mới thay, (8) tên người trực bảo trì ca đêm Chủ Nhật và số máy nhánh nội bộ.`
      : 'Câu hỏi kiểm tra trí nhớ: Hãy nêu đầy đủ (1) mã khách hàng, (2) mã đơn hàng, (3) hạn mức ngân sách, (4) họ tên người phê duyệt cuối cùng, VÀ (5) tra cứu lại trong lịch sử cũ cho biết mã tủ khóa lưu hồ sơ giấy phòng B và ngăn kéo để chìa khóa ở lượt 3 là gì?';

    const searchCallsBeforeFinalTurn = searchToolInvocations;
    const finalUser = await messageSink.addUserMessage({
      conversationId: convId,
      text: recallPrompt,
    });
    const finalAns = await turnResolver.resolveAnswer(
      {
        userId,
        channelId: convId,
        conversationId: convId,
        workspaceId: 'default',
        messageId: finalUser.id,
        prompt: recallPrompt,
        botUserId: 'bot-1',
        channelType: 'web',
      },
      randomUUID(),
    );

    const elapsedSec = ((Date.now() - startedAtMs) / 1000).toFixed(1);
    const finalTurnSearchCalls = searchToolInvocations - searchCallsBeforeFinalTurn;
    console.log(
      `\n=== [TURN ${totalTargetTurns} LIVE OPENAI RECALL ANSWER] (recentTurns=${finalContext.recentTurns.length}, compactions=${compactionCount}, finalTurnSearchCalls=${finalTurnSearchCalls}, elapsed=${elapsedSec}s) ===`,
    );
    console.log(finalAns.content);
    console.log('====================================================\n');

    const baseChecks: ReadonlyArray<[string, string]> = [
      ['Mã khách (Turn 1)', 'vip-9910'],
      ['Mã đơn (Turn 1)', 'ord-8899'],
      ['Hạn mức (Turn 1)', '150'],
      ['Ng.duyệt (Turn 4)', 'minh anh'],
      ['Tủ khóa (Turn 3)', 'cabinet-z91'],
    ];
    const stressChecks: ReadonlyArray<[string, string]> = [
      ['Ngăn kéo (Turn 3)', 'ngăn kéo 4'],
      ['Biển số xe (Turn 7)', '51c-84219'],
      ['Serial máy in (Turn 15)', 'sn-prn-4092'],
      ['Bảo trì/Ext (Turn 25)', 'ext-208'],
    ];
    const checks = isStressBenchmark
      ? [...baseChecks, ...stressChecks]
      : baseChecks;

    const normalizedAnswer = finalAns.content.toLowerCase();
    const normalizedSummary = summaryText.toLowerCase();
    let passedCount = 0;

    console.log('--- BẢNG ĐO CHI TIẾT ---');
    for (const [label, needle] of checks) {
      const inSummary = normalizedSummary.includes(needle);
      const inAnswer = normalizedAnswer.includes(needle);
      if (inAnswer) passedCount += 1;
      console.log(
        `- ${label} [${needle}]: inSummary=${inSummary ? 'YES' : 'NO'} | recalledInAnswer=${inAnswer ? 'PASS' : 'FAIL'}`,
      );
    }
    console.log(
      `Tổng điểm: ${passedCount}/${checks.length} | Tổng compaction: ${compactionCount} | Tổng search calls lượt cuối: ${finalTurnSearchCalls} | Thời gian: ${elapsedSec}s\n`,
    );

    if (!isStressBenchmark) {
      assertCondition(
        passedCount === checks.length,
        `Turn ${totalTargetTurns} chỉ nhớ ${passedCount}/${checks.length} dữ kiện`,
      );
    }
    console.log(`✅ LIVE EVAL COMPLETED (${totalTargetTurns} turns, score=${passedCount}/${checks.length}).`);
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
