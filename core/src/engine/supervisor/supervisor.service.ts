import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import {
  ORCHESTRATION_CONSTANTS,
  SUPERVISOR_PLANNING_PROMPT,
  SUPERVISOR_EVALUATE_PROMPT,
  SUPERVISOR_EVALUATE_SCHEMA,
  SUPERVISOR_EVALUATE_SCHEMA_NO_DONE,
  SUPERVISOR_SYNTHESIS_PROMPT,
  SUPERVISOR_PLAN_SCHEMA,
  SUPERVISOR_PLAN_SCHEMA_NO_ANSWER,
  PROVIDER_DESCRIPTIONS,
  ESupervisorVerdict,
} from '@agent/core/constants';
import { McpAuthClientService } from '../../infrastructure/tools/mcp/mcp-auth-client.service';
import { AGENT_REGISTRY } from '../../infrastructure/tools/dynamic/agents.registry';
import { DynamicProviderService } from '../../infrastructure/tools/dynamic/dynamic-provider.service';
import {
  AvailableAgentDto,
  DelegationDto,
  SupervisorEvaluateDto,
  SupervisorPlanDto,
  SupervisorRoundDto,
} from '../../contracts/dtos/supervisor.dto';
import { ChatHistoryTurnDto } from '../../contracts/dtos/message-client.dto';
import { ToolCallTraceDto } from '../../contracts/dtos/react-loop.dto';
import {
  ISkillCatalogReader,
  SKILL_CATALOG_READER,
} from '../../contracts/skill/skill-catalog-reader.interface';
import { LlmStrategyFactory } from '../strategy/llm-strategy.factory';
import { loadSkillCatalogSafely } from '../loop/utils/skill-catalog-loader.util';
import { checkQuantity, QuantityCheckResult } from '../loop/guards/quantity-check.util';
import { describeExternalServiceError } from '../loop/utils/external-service-error.util';
import { withLlmRetry } from '../loop/utils/with-llm-retry.util';
import { CircuitBreakerService } from '../../infrastructure/resilience/circuit-breaker.service';
import {
  PolicyCorpusService,
  SemanticPolicyEvaluatorService,
  EPolicyVerdict,
} from '../../security';
import {
  capRoundResults,
  capToolResultSize,
} from '../../common/text/token-budget.util';
import { hasPendingActionStep } from '../../common/pending-action-step.util';
import { MetricsRegistryService } from '../../infrastructure/resilience/metrics-registry.service';
import { MemoryManagerService } from '../../memory/memory-manager.service';
import { AgentRankingService } from './agent-ranking.service';
import { SupervisorPromptBuilder } from './supervisor-prompt.builder';
import { detectFrustration } from '../loop/utils/detect-frustration.util';
import { AgentRankingCache } from './supervisor.interface';

// Ghi chú thiết kế đầy đủ (WHY): docs/orchestration/code-notes/supervisor.service.md
@Injectable()
export class SupervisorService {
  private readonly logger = new Logger(SupervisorService.name);

  constructor(
    private readonly mcpAuthClient: McpAuthClientService,
    private readonly llmFactory: LlmStrategyFactory,
    private readonly circuitBreaker: CircuitBreakerService,
    private readonly dynamicProviderDb: DynamicProviderService,
    private readonly metrics: MetricsRegistryService,
    private readonly memoryManager: MemoryManagerService,
    private readonly agentRanking: AgentRankingService,
    private readonly promptBuilder: SupervisorPromptBuilder,
    @Optional()
    private readonly policyCorpus?: PolicyCorpusService,
    @Optional()
    private readonly semanticPolicyEvaluator?: SemanticPolicyEvaluatorService,
    @Optional()
    @Inject(SKILL_CATALOG_READER)
    private readonly skillCatalog?: ISkillCatalogReader,
  ) {}

  private getSystemAgents(): AvailableAgentDto[] {
    const provider = 'compute';
    if (!AGENT_REGISTRY[provider]?.endpoint) return [];
    return [
      {
        provider,
        label: AGENT_REGISTRY[provider].label,
        description: PROVIDER_DESCRIPTIONS[provider] ?? '',
      },
    ];
  }

  async getAvailableAgents(
    userId: string,
    workspaceId?: string,
  ): Promise<AvailableAgentDto[]> {
    const statuses = await this.mcpAuthClient.getConnectionStatus(userId);
    const staticAgents = statuses
      .filter(
        (status) =>
          status.is_connected && AGENT_REGISTRY[status.provider_id]?.endpoint,
      )
      .map((status) => ({
        provider: status.provider_id,
        label: AGENT_REGISTRY[status.provider_id].label,
        description: PROVIDER_DESCRIPTIONS[status.provider_id] ?? '',
      }));

    const dynamicEntities =
      await this.dynamicProviderDb.getProvidersByUser(userId);
    const dynamicAgents = dynamicEntities.map((entity) => ({
      provider: entity.id,
      label: entity.name,
      description:
        entity.description ||
        `Hệ thống/API mở rộng (Custom Swagger) tên "${entity.name}" — liên quan tới các thao tác/dữ liệu của hệ thống này (tham khảo: ${entity.specUrl}).`,
    }));

    return [
      ...staticAgents,
      ...this.getSystemAgents(),
      ...dynamicAgents,
    ];
  }

  async plan(
    prompt: string,
    agents: AvailableAgentDto[],
    rounds: SupervisorRoundDto[] = [],
    history: ChatHistoryTurnDto[] = [],
    rankingCache?: AgentRankingCache,
    signal?: AbortSignal,
    // ver3.md mục 1 (dài hạn) — optional, THÊM CUỐI CÙNG có chủ đích: giữ
    // nguyên tính tương thích vị trí (positional) của MỌI call site/test đã
    // có từ trước (rounds/history truyền theo vị trí thứ 3/4) — không dùng
    // channelId thì bỏ qua an toàn (memories = []).
    channelId?: string,
    // Cùng lý do trên — thêm cuối cùng. Skill scope theo workspace (không
    // theo channel như channel_memory), không truyền thì bỏ qua an toàn.
    workspaceId?: string,
  ): Promise<SupervisorPlanDto> {
    const { shown, omittedCount } =
      rankingCache?.current ??
      (await this.agentRanking.rankAgentsForPrompt(prompt, agents));
    if (rankingCache && !rankingCache.current) {
      rankingCache.current = { shown, omittedCount };
    }
    let agentListText: string;
    if (shown.length > 0) {
      let text = shown
        .map((a) => `- ${a.provider} (${a.label}): ${a.description}`)
        .join('\n');
      if (omittedCount > 0) {
        text += `\n(Còn ${omittedCount} hệ thống khác đã kết nối nhưng không liên quan tới câu hỏi này, đã ẩn bớt khỏi danh sách trên.)`;
      }
      agentListText = text;
    } else {
      agentListText =
        '(Người dùng chưa kết nối agent nào — nếu câu hỏi cần dữ liệu, trả lời "respond" và nhắc user vào Settings để kết nối.)';
    }

    const planSchema =
      rounds.length > 0
        ? SUPERVISOR_PLAN_SCHEMA_NO_ANSWER
        : SUPERVISOR_PLAN_SCHEMA;

    try {
      const planModelId =
        process.env.SUPERVISOR_PLANNING_MODEL ??
        process.env.SUPERVISOR_MODEL ??
        ORCHESTRATION_CONSTANTS.SUPERVISOR_MODEL;
      const { strategy, model } = this.llmFactory.resolve(planModelId);
      const memories = channelId
        ? await this.memoryManager.getMemories(channelId, planModelId, prompt)
        : [];
      const skillCatalogText = await loadSkillCatalogSafely(
        this.skillCatalog,
        this.logger,
        workspaceId,
      );
      // ver3.md mục 5 — chỉ để harvest thủ công cho eval dataset sau này
      // (grep log theo tag), KHÔNG ảnh hưởng tới prompt (đã xử lý trong
      // buildPrompt() riêng).
      const frustrationPattern = detectFrustration(prompt);
      if (frustrationPattern) {
        this.logger.warn(
          `[frustration-signal] channelId=${channelId ?? 'unknown'} pattern="${frustrationPattern}"`,
        );
      }
      // Policy Guard: Thẩm định chính sách ngữ nghĩa trước khi phân công SubAgent
      if (this.semanticPolicyEvaluator && rounds.length === 0) {
        try {
          const evalResult = await this.semanticPolicyEvaluator.evaluatePrompt(prompt);
          if (evalResult.verdict === EPolicyVerdict.REQUIRE_APPROVAL) {
            const hasAuthorizedTool = agents.some(
              (a) => a.provider === 'k8s_ops' || a.provider === 'ingress_manager',
            );
            if (!hasAuthorizedTool) {
              this.logger.warn(`[Supervisor Policy Guard] Chặn yêu cầu Ingress rủi ro cao không có tool: ${prompt}`);
              return {
                action: 'respond',
                answer: `Thao tác cấu hình định tuyến mạng Ingress diện rộng có rủi ro cao và cần có sự phê duyệt từ Quản trị viên (theo quy chế ${evalResult.citedRuleId || 'SEC-DEVOPS-002'}). Hệ thống không tự ý áp dụng hoặc hướng dẫn tạo file cấu hình khi chưa có phê duyệt chính thức.`,
              };
            }
          } else if (evalResult.verdict === EPolicyVerdict.DENY) {
            this.logger.warn(`[Supervisor Policy Guard] Chặn yêu cầu vi phạm chính sách cấm: ${prompt}`);
            return {
              action: 'respond',
              answer: `Từ chối thực thi: ${evalResult.reason || 'Yêu cầu vi phạm quy chế bảo mật doanh nghiệp.'} (Điều khoản: ${evalResult.citedRuleId || 'ENTERPRISE_POLICY'}).`,
            };
          } else if (evalResult.verdict === EPolicyVerdict.ESCALATE) {
            this.logger.warn(`[Supervisor Policy Guard] Chuyển tiếp sự vụ vượt thẩm quyền AI: ${prompt}`);
            return {
              action: 'respond',
              answer: `Yêu cầu vượt quá thẩm quyền của AI: ${evalResult.reason || 'Sự vụ cần được xử lý bởi nhân sự chuyên trách.'} (Điều khoản: ${evalResult.citedRuleId || 'ENTERPRISE_POLICY'}). Sự vụ đã được ghi nhận để nhân sự có thẩm quyền tiếp quản.`,
            };
          }
        } catch (err) {
          this.logger.warn(`Lỗi thẩm định policy ở Supervisor: ${(err as Error)?.message}`);
        }
      }

      let policyGuidance = '';
      if (this.policyCorpus) {
        try {
          const relevant = await this.policyCorpus.findRelevantPolicies(prompt, {
            limit: 3,
            minScore: 0.15,
          });

          if (relevant.length > 0) {
            const rules = relevant
              .map((r) => `- [${r.chunk.id}] ${r.chunk.title}: ${r.chunk.content}`)
              .join('\n');

            policyGuidance =
              `\n\n--- QUY CHẾ AN NINH & TUÂN THỦ DOANH NGHIỆP (BẮT BUỘC TUÂN THỦ) ---\n${rules}\n\n` +
              `QUY TẮC BẢO MẬT BẮT BUỘC CHO SUPERVISOR:\n` +
              `1. Nếu yêu cầu của người dùng thuộc diện cần phê duyệt (REQUIRE_APPROVAL) hoặc bị nghiêm cấm (DENY) hoặc vượt thẩm quyền (ESCALATE) mà hệ thống KHÔNG CÓ tool chính thức hỗ trợ quy trình đó (hoặc người dùng yêu cầu trực tiếp thay đổi định tuyến Ingress, xóa CSDL production, trích xuất bảng lương nhân viên):\n` +
              `   - BẠN BẮT BUỘC PHẢI CHỌN action="respond".\n` +
              `   - Điền "answer" bằng câu trả lời từ chối/yêu cầu phê duyệt rõ ràng, trích dẫn đúng mã điều khoản (ví dụ: SEC-DEVOPS-002, SEC-DEVOPS-001, SEC-HR-001).\n` +
              `   - TUYỆT ĐỐI KHÔNG phân công (plan) cho bất kỳ agent nào (như compute/python) để sinh script, YAML, JSON, hay viết hướng dẫn người dùng làm thủ công nhằm lách quy chế!`;
          }
        } catch (err) {
          this.logger.warn(`Lỗi truy xuất policy grounding ở Supervisor: ${(err as Error)?.message}`);
        }
      }

      const fullPrompt = this.promptBuilder.build(
        prompt,
        rounds,
        history,
        memories,
        planModelId,
        skillCatalogText,
      );
      this.logger.log(
        `plan() model=${model} agents=${agents.length} historyTurns=${history.length} prompt=${fullPrompt}`,
      );
      const plan = await this.circuitBreaker.run(
        `llm:${strategy.id}`,
        () =>
          withLlmRetry(
            (attemptSignal) =>
              strategy.generateStructured<SupervisorPlanDto>({
                model,
                systemInstruction: `${SUPERVISOR_PLANNING_PROMPT}${policyGuidance}\n${agentListText}`,
                prompt: fullPrompt,
                schema: planSchema,
                signal: attemptSignal,
              }),
            ORCHESTRATION_CONSTANTS.LLM_CALL_TIMEOUT_MS,
            `Supervisor plan() timeout sau ${ORCHESTRATION_CONSTANTS.LLM_CALL_TIMEOUT_MS / 1000}s (model=${model})`,
            { signal },
          ),
        signal,
      );
      this.logger.log(`plan() result=${JSON.stringify(plan)}`);
      if (plan.action === 'plan' && plan.steps?.[0]) {
        const cluster = this.agentRanking.findAmbiguousAgentCluster(
          prompt,
          shown,
          plan.steps[0].agent,
        );
        if (cluster) {
          this.logger.warn(
            `[ambiguous-agent-cluster] plan() chọn "${plan.steps[0].agent}" giữa ${cluster.length} agent mô tả tương tự nhau — candidates=${cluster.map((a) => a.provider).join(',')}`,
          );
          this.metrics.incrementBehaviorSignal('ambiguous_cluster');
          plan.ambiguousCandidates = cluster;
          return this.escalateIfAmbiguous(
            plan,
            fullPrompt,
            agentListText,
            planSchema,
            shown,
            prompt,
            signal,
          );
        }
      }
      return plan;
    } catch (error) {
      if (signal?.aborted) {
        throw error;
      }
      this.logger.error(
        `Supervisor plan() failed: ${(error as Error).message}`,
        (error as Error).stack,
      );
      return { action: 'respond', answer: describeExternalServiceError(error) };
    }
  }

  // ver3.md — model rẻ bị bias theo vị trí khi 2 agent mô tả giống nhau (đo
  // được qua eval-supervisor-plan.ts); model mạnh hơn không còn bias này. Chỉ
  // escalate ĐÚNG lúc cluster mơ hồ bị phát hiện (hiếm) — không tràn lan.
  // Off theo mặc định (SUPERVISOR_ESCALATION_MODEL không set = bỏ qua), để
  // không tự ý tốn thêm tiền khi chưa ai bật.
  private async escalateIfAmbiguous(
    plan: SupervisorPlanDto,
    fullPrompt: string,
    agentListText: string,
    schema: Record<string, unknown>,
    shown: AvailableAgentDto[],
    prompt: string,
    signal?: AbortSignal,
  ): Promise<SupervisorPlanDto> {
    const escalationModelId = process.env.SUPERVISOR_ESCALATION_MODEL;
    if (!escalationModelId) return plan;

    try {
      const { strategy, model } = this.llmFactory.resolve(escalationModelId);
      const escalated = await this.circuitBreaker.run(
        `llm:${strategy.id}`,
        () =>
          withLlmRetry(
            (attemptSignal) =>
              strategy.generateStructured<SupervisorPlanDto>({
                model,
                systemInstruction: `${SUPERVISOR_PLANNING_PROMPT}\n${agentListText}`,
                prompt: fullPrompt,
                schema,
                signal: attemptSignal,
              }),
            ORCHESTRATION_CONSTANTS.LLM_CALL_TIMEOUT_MS,
            `Supervisor plan() escalation timeout sau ${ORCHESTRATION_CONSTANTS.LLM_CALL_TIMEOUT_MS / 1000}s (model=${model})`,
            { signal },
          ),
        signal,
      );
      this.metrics.incrementBehaviorSignal('model_escalation');
      this.logger.log(
        `plan() escalated to ${model} do cluster mơ hồ — result=${JSON.stringify(escalated)}`,
      );
      if (escalated.action === 'plan' && escalated.steps?.[0]) {
        escalated.ambiguousCandidates =
          this.agentRanking.findAmbiguousAgentCluster(
            prompt,
            shown,
            escalated.steps[0].agent,
          ) ?? undefined;
      }
      return escalated;
    } catch (error) {
      if (signal?.aborted) {
        throw error;
      }
      this.logger.warn(
        `plan() escalation thất bại, giữ nguyên kết quả gốc: ${(error as Error).message}`,
      );
      return plan;
    }
  }

  async evaluate(
    originalPrompt: string,
    completedStep: SupervisorRoundDto,
    remainingSteps: DelegationDto[],
    signal?: AbortSignal,
  ): Promise<SupervisorEvaluateDto> {
    if (remainingSteps.length === 0) {
      return { verdict: ESupervisorVerdict.DONE };
    }

    const evaluateModelId =
      process.env.SUPERVISOR_EVALUATE_MODEL ??
      process.env.SUPERVISOR_MODEL ??
      ORCHESTRATION_CONSTANTS.SUPERVISOR_MODEL;
    const cappedResult = capToolResultSize(
      completedStep.result,
      this.memoryManager.buildBudget(evaluateModelId).toolResultCharBudget,
    );
    const remainingText = remainingSteps
      .map((s, i) => {
        let marker = '';
        if (s.mustExecute === true) {
          marker = ' [BẮT BUỘC — không được bỏ qua]';
        } else if (s.mustExecute === false) {
          marker = ' [không bắt buộc — có thể bỏ qua nếu đã đủ dữ liệu]';
        }
        return `${i + 1}. Agent "${s.agent}": ${s.task}${marker}`;
      })
      .join('\n');
    const mustFinishRemaining = hasPendingActionStep(remainingSteps);
    const doneNotAllowedNote = mustFinishRemaining
      ? '\n\nLƯU Ý: còn ít nhất 1 bước BẮT BUỘC (đánh dấu ở trên) chưa chạy — "done" không phải lựa chọn hợp lệ ở lượt này, chỉ được chọn "continue" hoặc "replan".'
      : '';
    const prompt = `Câu hỏi gốc: ${originalPrompt}\n\nBước vừa thực hiện xong — Agent "${completedStep.agent}" (yêu cầu: "${completedStep.task}") → kết quả: ${cappedResult}\n\nCác bước CÒN LẠI trong kế hoạch (chưa chạy):\n${remainingText}\n\nBước vừa xong có đạt kỳ vọng không, các bước còn lại có còn hợp lý để tiếp tục không?${doneNotAllowedNote}`;

    try {
      const { strategy, model } = this.llmFactory.resolve(evaluateModelId);
      const verdict = await this.circuitBreaker.run(
        `llm:${strategy.id}`,
        () =>
          withLlmRetry(
            (attemptSignal) =>
              strategy.generateStructured<SupervisorEvaluateDto>({
                model,
                systemInstruction: SUPERVISOR_EVALUATE_PROMPT,
                prompt,
                schema: mustFinishRemaining
                  ? SUPERVISOR_EVALUATE_SCHEMA_NO_DONE
                  : SUPERVISOR_EVALUATE_SCHEMA,
                signal: attemptSignal,
              }),
            ORCHESTRATION_CONSTANTS.LLM_CALL_TIMEOUT_MS,
            `Supervisor evaluate() timeout sau ${ORCHESTRATION_CONSTANTS.LLM_CALL_TIMEOUT_MS / 1000}s (model=${model})`,
            { signal },
          ),
        signal,
      );
      this.logger.log(`evaluate() result=${JSON.stringify(verdict)}`);
      return verdict;
    } catch (error) {
      if (signal?.aborted) {
        throw error;
      }
      this.logger.error(
        `Supervisor evaluate() failed: ${(error as Error).message}`,
        (error as Error).stack,
      );
      return { verdict: ESupervisorVerdict.CONTINUE };
    }
  }

  // HH1 (manual_test_bank_heavy.md) — checkQuantity() ở react-loop-run.ts chỉ
  // so cục bộ TRONG 1 ReactLoopService.run(); khi Supervisor tự lặp/tách
  // nhiều step cho CÙNG 1 yêu cầu số lượng (VD 12 sản phẩm), mỗi step tự thấy
  // đủ dù TỔNG cả turn đã vượt/thiếu — synthesize() vẫn có thể báo sai số. Gọi
  // SAU CÙNG (finalizeAnswer()), gộp resultPreview của TOÀN BỘ toolCalls turn.
  async checkCumulativeQuantity(
    originalPrompt: string,
    toolCalls: ToolCallTraceDto[],
    signal?: AbortSignal,
  ): Promise<QuantityCheckResult> {
    const resultsText = toolCalls
      .filter((tc) => tc.status === 'success' && tc.resultPreview)
      .map((tc) => `${tc.tool}: ${tc.resultPreview}`)
      .join('\n');
    if (!resultsText) {
      return { requiredCount: 0, achievedCount: 0 };
    }

    const modelId =
      process.env.SUPERVISOR_EVALUATE_MODEL ??
      process.env.SUPERVISOR_MODEL ??
      ORCHESTRATION_CONSTANTS.SUPERVISOR_MODEL;
    const { strategy, model } = this.llmFactory.resolve(modelId);
    return checkQuantity(
      originalPrompt,
      resultsText,
      strategy,
      model,
      this.circuitBreaker,
      this.logger,
      signal,
    );
  }

  async synthesize(
    originalPrompt: string,
    rounds: SupervisorRoundDto[],
    onToken?: (chunk: string) => void,
    signal?: AbortSignal,
  ): Promise<string> {
    try {
      const modelId =
        process.env.SUPERVISOR_MODEL ??
        ORCHESTRATION_CONSTANTS.SUPERVISOR_MODEL;
      const { strategy, model } = this.llmFactory.resolve(modelId);

      const roundsText = capRoundResults(
        rounds,
        this.memoryManager.buildBudget(modelId).toolResultCharBudget,
      )
        .map(
          (r, i) =>
            `${i + 1}. Agent "${r.agent}" (yêu cầu: "${r.task}") → kết quả: ${r.result}`,
        )
        .join('\n');

      const session = strategy.startChat({
        model,
        systemInstruction: SUPERVISOR_SYNTHESIS_PROMPT,
        tools: [],
        history: [],
      });

      const prompt = `Câu hỏi gốc: ${originalPrompt}\n\nDữ liệu đã thu thập được:\n${roundsText}\n\nHãy tổng hợp các dữ liệu trên thành một câu trả lời hoàn chỉnh cho người dùng.`;

      // streamedAnything reset lại MỖI lần thử (đầu fn()) — chỉ cho retry khi
      // lần vừa lỗi CHƯA stream ra token nào (xem ORCHESTRATION_CONSTANTS.MAX_LLM_CALL_RETRY_ATTEMPTS).
      let streamedAnything = false;
      let trackedOnToken: ((chunk: string) => void) | undefined;
      if (onToken) {
        trackedOnToken = (chunk: string) => {
          streamedAnything = true;
          onToken(chunk);
        };
      }
      const result = await this.circuitBreaker.run(
        `llm:${strategy.id}`,
        () =>
          withLlmRetry(
            (attemptSignal) => {
              streamedAnything = false;
              return session.sendMessage(prompt, trackedOnToken, attemptSignal);
            },
            ORCHESTRATION_CONSTANTS.LLM_CALL_TIMEOUT_MS,
            `Supervisor synthesize() timeout sau ${ORCHESTRATION_CONSTANTS.LLM_CALL_TIMEOUT_MS / 1000}s (model=${model})`,
            { signal, canRetry: () => !streamedAnything },
          ),
        signal,
      );
      this.logger.log(`synthesize() result=${result.text}`);
      return result.text;
    } catch (error) {
      // Bị Stop giữa chừng — đẩy lên cho runCancellable() hiện "Đã dừng theo
      // yêu cầu", không log ERROR/trả fallback answer như lỗi provider thật.
      if (signal?.aborted) {
        throw error;
      }
      this.logger.error(
        `Supervisor synthesize() failed: ${(error as Error).message}`,
        (error as Error).stack,
      );
      return describeExternalServiceError(error);
    }
  }
}
