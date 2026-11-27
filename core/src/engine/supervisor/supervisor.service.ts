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
import {
  resolveEscalationModelId,
  resolveSupervisorModelId,
} from './utils/supervisor-model.util';
import {
  buildDynamicAgentDescription,
  buildEvaluatePrompt,
  buildSynthesisPrompt,
  buildIngressApprovalRequiredAnswer,
  buildPolicyDeniedAnswer,
  buildPolicyEscalatedAnswer,
  buildSupervisorPolicyGuidance,
  formatAgentList,
} from './utils/supervisor-guidance-prompt.util';
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
import { AgentDiscoveryService } from '../discovery/agent-discovery.service';
import { detectFrustration } from '../loop/utils/detect-frustration.util';
import { AgentRankingCache } from './supervisor.interface';

// Ghi chú thiết kế đầy đủ (WHY): docs/orchestration/code-notes/supervisor.service.md
export interface SupervisorPlanRequestOptions {
  readonly prompt: string;
  readonly agents: AvailableAgentDto[];
  readonly rounds?: SupervisorRoundDto[];
  readonly history?: ChatHistoryTurnDto[];
  readonly contextSummary?: string;
  readonly rankingCache?: AgentRankingCache;
  readonly signal?: AbortSignal;
  readonly channelId?: string;
  readonly workspaceId?: string;
}

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
    @Optional()
    private readonly agentDiscovery?: AgentDiscoveryService,
  ) {}

  // Một lời gọi LLM của Supervisor: circuit breaker theo strategy + retry có timeout. `canRetry`
  // dành cho lệnh gọi có stream (đã stream token thì không được retry mù).
  private callLlm<T>(
    strategyId: string,
    label: string,
    model: string,
    attempt: (attemptSignal: AbortSignal) => Promise<T>,
    signal?: AbortSignal,
    canRetry?: () => boolean,
  ): Promise<T> {
    return this.circuitBreaker.run(
      `llm:${strategyId}`,
      () =>
        withLlmRetry(
          attempt,
          ORCHESTRATION_CONSTANTS.LLM_CALL_TIMEOUT_MS,
          `Supervisor ${label} timeout sau ${ORCHESTRATION_CONSTANTS.LLM_CALL_TIMEOUT_MS / 1000}s (model=${model})`,
          { signal, canRetry },
        ),
      signal,
    );
  }

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
    if (this.agentDiscovery) {
      return this.agentDiscovery.getAvailableAgents(userId, workspaceId);
    }
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
        buildDynamicAgentDescription(entity.name, entity.specUrl),
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
    channelId?: string,
    workspaceId?: string,
  ): Promise<SupervisorPlanDto> {
    return this.planWithContext({
      prompt,
      agents,
      rounds,
      history,
      rankingCache,
      signal,
      channelId,
      workspaceId,
    });
  }

  async planWithContext(
    options: SupervisorPlanRequestOptions,
  ): Promise<SupervisorPlanDto> {
    const {
      prompt,
      agents,
      rounds = [],
      history = [],
      contextSummary,
      rankingCache,
      signal,
      channelId,
      workspaceId,
    } = options;
    const { shown, omittedCount } =
      rankingCache?.current ??
      (await this.agentRanking.rankAgentsForPrompt(prompt, agents));
    if (rankingCache && !rankingCache.current) {
      rankingCache.current = { shown, omittedCount };
    }
    const agentListText = formatAgentList(shown, omittedCount);

    const planSchema = this.selectPlanSchema(rounds);

    try {
      const planModelId = resolveSupervisorModelId('plan');
      const { strategy, model } = this.llmFactory.resolve(planModelId);
      const skillCatalogText = await loadSkillCatalogSafely(
        this.skillCatalog,
        this.logger,
        workspaceId,
      );
      this.logFrustrationSignal(prompt, channelId);
      const blocked = await this.applyPolicyGuard(prompt, agents, rounds);
      if (blocked) return blocked;

      const policyGuidance = await this.buildPolicyGuidance(prompt);

      const fullPrompt = this.promptBuilder.buildPlanPrompt({
        originalPrompt: prompt,
        previousRounds: rounds,
        history,
        modelId: planModelId,
        contextSummary,
        skillCatalog: skillCatalogText,
      });
      this.logger.log(
        `plan() model=${model} agents=${agents.length} historyTurns=${history.length} prompt=${fullPrompt}`,
      );
      const plan = await this.callLlm(
        strategy.id,
        'plan()',
        model,
        (attemptSignal) =>
          strategy.generateStructured<SupervisorPlanDto>({
            model,
            systemInstruction: `${SUPERVISOR_PLANNING_PROMPT}${policyGuidance}\n${agentListText}`,
            prompt: fullPrompt,
            schema: planSchema,
            signal: attemptSignal,
          }),
        signal,
      );
      this.logger.log(`plan() result=${JSON.stringify(plan)}`);
      // await (không return thẳng promise) để lỗi đồng bộ trong bước này vẫn rơi vào catch bên dưới như cũ.
      return await this.resolveAmbiguousPlan(
        plan,
        fullPrompt,
        agentListText,
        planSchema,
        shown,
        prompt,
        signal,
      );
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

  // Đã có round trước đó thì Supervisor không được "respond" trực tiếp ngay từ đầu turn (schema không có answer).
  private selectPlanSchema(rounds: SupervisorRoundDto[]) {
    return rounds.length > 0
      ? SUPERVISOR_PLAN_SCHEMA_NO_ANSWER
      : SUPERVISOR_PLAN_SCHEMA;
  }

  private logFrustrationSignal(prompt: string, channelId?: string): void {
    const frustrationPattern = detectFrustration(prompt);
    if (frustrationPattern) {
      this.logger.warn(
        `[frustration-signal] channelId=${channelId ?? 'unknown'} pattern="${frustrationPattern}"`,
      );
    }
  }

  // Nếu bước đầu của plan chọn giữa các agent mô tả tương tự nhau thì ghi nhận
  // cluster mơ hồ và (nếu bật) escalate sang model mạnh hơn; ngược lại giữ nguyên plan.
  private async resolveAmbiguousPlan(
    plan: SupervisorPlanDto,
    fullPrompt: string,
    agentListText: string,
    planSchema: Record<string, unknown>,
    shown: AvailableAgentDto[],
    prompt: string,
    signal?: AbortSignal,
  ): Promise<SupervisorPlanDto> {
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
  }

  // Policy Guard: thẩm định chính sách ngữ nghĩa trước khi phân công SubAgent.
  // Trả về câu trả lời chặn (respond) hoặc undefined nếu được phép đi tiếp.
  private async applyPolicyGuard(
    prompt: string,
    agents: AvailableAgentDto[],
    rounds: SupervisorRoundDto[],
  ): Promise<SupervisorPlanDto | undefined> {
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
              answer: buildIngressApprovalRequiredAnswer(evalResult.citedRuleId),
            };
          }
        } else if (evalResult.verdict === EPolicyVerdict.DENY) {
          this.logger.warn(`[Supervisor Policy Guard] Chặn yêu cầu vi phạm chính sách cấm: ${prompt}`);
          return {
            action: 'respond',
            answer: buildPolicyDeniedAnswer(evalResult.reason, evalResult.citedRuleId),
          };
        } else if (evalResult.verdict === EPolicyVerdict.ESCALATE) {
          this.logger.warn(`[Supervisor Policy Guard] Chuyển tiếp sự vụ vượt thẩm quyền AI: ${prompt}`);
          return {
            action: 'respond',
            answer: buildPolicyEscalatedAnswer(evalResult.reason, evalResult.citedRuleId),
          };
        }
      } catch (err) {
        this.logger.warn(`Lỗi thẩm định policy ở Supervisor: ${(err as Error)?.message}`);
      }
    }
    return undefined;
  }

  private async buildPolicyGuidance(prompt: string): Promise<string> {
    let policyGuidance = '';
    if (this.policyCorpus) {
      try {
        const relevant = await this.policyCorpus.findRelevantPolicies(prompt, {
          limit: 3,
          minScore: 0.15,
        });

        policyGuidance = buildSupervisorPolicyGuidance(
          relevant.map((r) => r.chunk),
        );
      } catch (err) {
        this.logger.warn(`Lỗi truy xuất policy grounding ở Supervisor: ${(err as Error)?.message}`);
      }
    }
    return policyGuidance;
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
    const escalationModelId = resolveEscalationModelId();
    if (!escalationModelId) return plan;

    try {
      const { strategy, model } = this.llmFactory.resolve(escalationModelId);
      const escalated = await this.callLlm(
        strategy.id,
        'plan() escalation',
        model,
        (attemptSignal) =>
          strategy.generateStructured<SupervisorPlanDto>({
            model,
            systemInstruction: `${SUPERVISOR_PLANNING_PROMPT}\n${agentListText}`,
            prompt: fullPrompt,
            schema,
            signal: attemptSignal,
          }),
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

    const evaluateModelId = resolveSupervisorModelId('evaluate');
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
    const prompt = buildEvaluatePrompt({
      originalPrompt,
      completedAgent: completedStep.agent,
      completedTask: completedStep.task,
      cappedResult,
      remainingText,
      mustFinishRemaining,
    });

    try {
      const { strategy, model } = this.llmFactory.resolve(evaluateModelId);
      const verdict = await this.callLlm(
        strategy.id,
        'evaluate()',
        model,
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

    const modelId = resolveSupervisorModelId('evaluate');
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
    contextSummary?: string,
  ): Promise<string> {
    try {
      const modelId = resolveSupervisorModelId('synthesize');
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

      const prompt = buildSynthesisPrompt(
        originalPrompt,
        roundsText,
        contextSummary,
      );

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
      const result = await this.callLlm(
        strategy.id,
        'synthesize()',
        model,
        (attemptSignal) => {
          streamedAnything = false;
          return session.sendMessage(prompt, trackedOnToken, attemptSignal);
        },
        signal,
        () => !streamedAnything,
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
