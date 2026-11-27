import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import {
  ORCHESTRATION_CONSTANTS,
  ECheckpointKind,
  NATIVE_TOOL_PROVIDER,
} from '@agent/core/constants';
import {
  IExecutionEngine,
  EngineRoutingContext,
  EngineExecutionContext,
  EExecutionEngineMode,
  EForcedExecutionMode,
} from '../../../contracts/engine/execution-engine.interface';
import {
  AnswerResult,
  ApprovalRequiredDelegateResult,
  buildAnswer,
} from '../../../contracts/engine/orchestration-answer.types';
import { ReactLoopService } from '../../loop/react-loop.service';
import { AgentCancellationService } from '../../cancellation/agent-cancellation.service';
import { assertNotCancelled } from '../../cancellation/assert-not-cancelled.util';
import { CheckpointPauseService } from '../../hitl/checkpoint-pause.service';
import { MetricsRegistryService } from '../../../infrastructure/resilience/metrics-registry.service';
import { TurnCancelledError } from '../../loop/errors/turn-cancelled.error';
import { ApprovalRequiredError } from '../../loop/errors/approval-required.error';
import {
  RunReactLoopRequestDto,
  ToolCallTraceDto,
} from '../../../contracts/dtos/react-loop.dto';
import { ExecutedStepDto } from '../../../contracts/dtos/message-client.dto';
import { SubAgentSpawnerService } from './sub-agent-spawner.service';
import {
  capToolResultSize,
  resolveDataCharBudget,
} from '../../../common/text/token-budget.util';
import { buildReactRequestIdentity } from '../utils/react-request-identity.util';
import {
  buildApprovalFollowUpPrompt,
  buildApprovedToolFailureMessage,
  buildClarifiedPrompt,
} from './utils/engine-prompt.util';
import { ClarificationRequiredError } from '../../../contracts/engine/clarification-required.error';
import { IClarificationCandidate } from '../../../contracts';
import {
  AvailableAgentDto,
  DelegationDto,
  SupervisorRoundDto,
} from '../../../contracts/dtos/supervisor.dto';
import { SupervisorService } from '../../supervisor/supervisor.service';
import { AgentRankingService } from '../../supervisor/agent-ranking.service';
import { AgentDiscoveryService } from '../../discovery/agent-discovery.service';
import {
  IToolProvider,
  TOOL_PROVIDER,
  IStreamSink,
  STREAM_SINK,
} from '../../../contracts';
import { CheckpointResponseDto } from '../../../contracts/dtos/checkpoint.dto';
import { CheckpointService } from '../../hitl/checkpoint.service';
import { executeApprovedTool } from '../../hitl/utils/approved-tool-execution.util';
import { MemoryManagerService } from '../../../memory/memory-manager.service';
import { TurnResolverRun } from '../turn/turn-resolver-run';
import { TurnResolverRunOptions } from '../turn/turn-resolver.interface';
import { runCancellable } from '../../cancellation/cancellable-run.util';
import { SPAWN_SUBAGENT_TOOL_SCHEMA } from '../../../contracts/engine/sub-agent-spawner.interface';
import { CachedService } from '../../../infrastructure/redis/cached.service';
import { LlmStrategyFactory } from '../../strategy/llm-strategy.factory';

/**
 * AutonomousEngine
 *
 * Thái cực 2: Động cơ thực thi tự trị thích ứng (Adaptive Autonomous Multi-Agent Engine).
 * HỢP NHẤT HOÀN TOÀN 2 MÔ HÌNH:
 * - Tầng 1 (Frontline): Multi-Provider ReAct loop trực tiếp (< 2s latency, tối ưu chi phí token).
 * - Tầng 2 (Supervisor Planning): Khi gặp tác vụ phức tạp/đa mục tiêu hoặc đối kháng,
 *   kích hoạt chu trình Dynamic Multi-Agent (Plan -> Delegate -> Evaluate -> Synthesize).
 * - On-demand Delegation: Cho phép LLM tự động spawn sub-agent ngầm khi gặp tài liệu lớn.
 */
@Injectable()
export class AutonomousEngine implements IExecutionEngine {
  readonly id = EExecutionEngineMode.AUTONOMOUS;
  readonly name = 'Adaptive Autonomous Multi-Agent Engine';
  readonly priority = 10;

  private readonly logger = new Logger(AutonomousEngine.name);

  constructor(
    private readonly reactLoop: ReactLoopService,
    private readonly cancellation: AgentCancellationService,
    private readonly checkpointPause: CheckpointPauseService,
    private readonly metrics: MetricsRegistryService,
    @Optional()
    private readonly subAgentSpawner?: SubAgentSpawnerService,
    @Optional()
    private readonly supervisor?: SupervisorService,
    @Optional()
    @Inject(STREAM_SINK)
    private readonly streamSink?: IStreamSink,
    @Optional()
    private readonly memoryManager?: MemoryManagerService,
    @Optional()
    @Inject(TOOL_PROVIDER)
    private readonly toolProvider?: IToolProvider,
    @Optional()
    private readonly checkpointService?: CheckpointService,
    @Optional()
    private readonly agentDiscovery?: AgentDiscoveryService,
    @Optional()
    private readonly cachedService?: CachedService,
    @Optional()
    private readonly llmFactory?: LlmStrategyFactory,
    @Optional()
    private readonly agentRanking?: AgentRankingService,
  ) {}

  canHandle(context: EngineRoutingContext): boolean {
    if (
      context.forcedMode === EForcedExecutionMode.AUTONOMOUS ||
      context.forcedMode === EForcedExecutionMode.SINGLE ||
      context.forcedMode === EForcedExecutionMode.SUPERVISOR
    ) {
      return true;
    }
    if (context.forcedMode && context.forcedMode !== EForcedExecutionMode.AUTO) {
      return false;
    }
    return !context.workflowId && !context.metadata?.graph && !context.metadata?.pipeline;
  }

  async execute(context: EngineExecutionContext): Promise<AnswerResult> {
    const { replyMessageId } = context;

    // Quyết định tầng thực thi: Frontline ReAct hay Dynamic Supervisor
    if (this.shouldTriggerSupervisorPlanning(context)) {
      this.logger.log(
        `[AutonomousEngine] Tác vụ phức tạp/phân rã -> Kích hoạt Tầng 2: Dynamic Supervisor Planning cho turn ${replyMessageId}`,
      );
      return this.executeSupervisorPlanning(context);
    }

    this.logger.log(
      `[AutonomousEngine] Tác vụ đàm thoại trực tiếp -> Kích hoạt Tầng 1: Frontline ReAct cho turn ${replyMessageId}`,
    );
    return this.executeFrontlineReAct(context);
  }

  private shouldTriggerSupervisorPlanning(context: EngineExecutionContext): boolean {
    const forced = context.metadata?.forcedMode ?? context.data?.sessionType;
    if (
      forced === EForcedExecutionMode.SUPERVISOR ||
      forced === 'supervisor'
    ) {
      return true;
    }
    if (
      forced === EForcedExecutionMode.SINGLE ||
      forced === 'single'
    ) {
      return false;
    }

    // Dynamic Context Budget: Tính toán dung lượng ngữ cảnh tổng thể (prompt + history)
    const promptChars = context.prompt?.length ?? 0;
    const historyChars = (context.history ?? []).reduce(
      (sum, h) => sum + (h.text?.length ?? 0),
      0,
    );
    const totalEstimatedChars = promptChars + historyChars;

    const activeModel =
      process.env.DEFAULT_REACT_MODEL ??
      ORCHESTRATION_CONSTANTS.DEFAULT_REACT_MODEL;
    const allowedDataBudget = resolveDataCharBudget(activeModel);

    // Kích hoạt Tầng 2 (Supervisor Planning) khi tổng ngữ cảnh vượt quá 60% ngân sách an toàn của model (tối thiểu 30.000 ký tự)
    const dynamicThreshold = Math.max(30_000, Math.floor(allowedDataBudget * 0.6));

    if (totalEstimatedChars > dynamicThreshold) {
      this.logger.log(
        `[AutonomousEngine] Tổng ngữ cảnh (${totalEstimatedChars} chars) vượt ngưỡng dynamic (${dynamicThreshold} chars cho model ${activeModel}) -> Kích hoạt Supervisor`,
      );
      return true;
    }

    return false;
  }

  // ==========================================
  // TẦNG 1: FRONTLINE ADAPTIVE REACT (Single Agent)
  // ==========================================

  private async executeFrontlineReAct(context: EngineExecutionContext): Promise<AnswerResult> {
    const { data, replyMessageId, prompt, agents, history, signal } = context;

    // Dynamic Provider Pruning: Khi số agent kết nối vượt ngưỡng (mặc định 3), dùng vector ranking chọn lọc
    let effectiveAgents = agents ?? [];
    if (
      this.agentRanking &&
      effectiveAgents.length >
      ORCHESTRATION_CONSTANTS.MAX_FRONTLINE_AGENTS_BEFORE_RANKING
    ) {
      const ranked = await this.agentRanking.rankAgentsForPrompt(
        prompt,
        effectiveAgents,
        ORCHESTRATION_CONSTANTS.MAX_FRONTLINE_AGENTS_BEFORE_RANKING,
      );
      effectiveAgents = ranked.shown;
      if (ranked.omittedCount > 0) {
        this.logger.log(
          `[AutonomousEngine] Frontline Tool RAG: Chọn ${effectiveAgents.length} agents (${effectiveAgents.map((a) => a.provider).join(', ')}), ẩn ${ranked.omittedCount} agents để tiết kiệm tokens`,
        );
      }
    }

    const connectedProviders = effectiveAgents.map((a) => a.provider);
    const primaryProvider = connectedProviders[0] ?? NATIVE_TOOL_PROVIDER;

    const requestDto: RunReactLoopRequestDto = {
      prompt,
      provider: primaryProvider,
      providers: connectedProviders.length > 0 ? connectedProviders : [primaryProvider],
      ...buildReactRequestIdentity(data),
      messageId: replyMessageId,
      history,
      ...(context.contextSummary ? { contextSummary: context.contextSummary } : {}),
      model: process.env.DEFAULT_REACT_MODEL ?? ORCHESTRATION_CONSTANTS.DEFAULT_REACT_MODEL,
      maxSelfCorrectionRetries: 2,
    };

    try {
      const result = await this.reactLoop.run(requestDto, signal);

      if (result.clarificationRequired) {
        this.logger.warn(
          `[AutonomousEngine] Phát hiện yêu cầu làm rõ: "${result.clarificationRequired.question}"`,
        );
        return this.pauseForClarification(
          context,
          connectedProviders,
          result.clarificationRequired.question,
          result.clarificationRequired.candidates,
          result.toolCalls,
        );
      }

      const priorToolCalls =
        (context.metadata?.priorToolCalls as ToolCallTraceDto[]) ?? [];
      const allToolCalls = [...priorToolCalls, ...result.toolCalls];

      return buildAnswer(result.answer, allToolCalls, [
        this.buildAgentStep(prompt, connectedProviders, allToolCalls, result.answer),
      ]);
    } catch (error) {
      return this.handleExecuteError(error, context, connectedProviders);
    }
  }

  // ==========================================
  // TẦNG 2: DYNAMIC SUPERVISOR PLANNING (Supervisor)
  // ==========================================

  private async executeSupervisorPlanning(context: EngineExecutionContext): Promise<AnswerResult> {
    if (!this.supervisor || !this.streamSink || !this.memoryManager) {
      this.logger.warn('[AutonomousEngine] Thiếu dependencies cho Supervisor, fallback về Frontline ReAct');
      return this.executeFrontlineReAct(context);
    }

    return this.runSupervisorLoop({
      data: context.data,
      replyMessageId: context.replyMessageId,
      prompt: context.prompt,
      agents: context.agents,
      history: context.history,
      contextSummary: context.contextSummary,
      rounds: [],
      toolCalls: [],
      signal: context.signal,
    });
  }

  async runSupervisorLoop(
    options: TurnResolverRunOptions & {
      forcedStep?: DelegationDto;
      remainingSteps?: DelegationDto[];
    },
  ): Promise<AnswerResult> {
    const { forcedStep, remainingSteps, signal, ...runOptions } = options;
    const runTurn = (sig?: AbortSignal) =>
      new TurnResolverRun(
        { ...runOptions, signal: sig },
        {
          reactLoop: this.reactLoop,
          supervisor: this.supervisor!,
          streamSink: this.streamSink!,
          agentStream: this.streamSink!,
          cancellation: this.cancellation,
          checkpointPause: this.checkpointPause,
          metrics: this.metrics,
          memoryManager: this.memoryManager!,
          logger: this.logger,
        },
      ).run(forcedStep, remainingSteps);

    if (signal) {
      return runTurn(signal);
    }

    return runCancellable(
      runOptions.replyMessageId,
      this.cancellation,
      (sig) => runTurn(sig),
      () => {
        const partialText =
          runOptions.rounds.length > 0
            ? runOptions.rounds[runOptions.rounds.length - 1].result
            : undefined;
        return new TurnCancelledError(partialText);
      },
    );
  }

  async continueSupervisorRounds(
    data: EngineExecutionContext['data'],
    replyMessageId: string,
    prompt: string,
    agents: AvailableAgentDto[],
    history: EngineExecutionContext['history'],
    rounds: SupervisorRoundDto[],
    toolCalls: ToolCallTraceDto[],
    forcedStep?: DelegationDto,
    remainingSteps?: DelegationDto[],
    signal?: AbortSignal,
  ): Promise<AnswerResult> {
    return this.runSupervisorLoop({
      data,
      replyMessageId,
      prompt,
      agents,
      history,
      rounds,
      toolCalls,
      forcedStep,
      remainingSteps,
      signal,
    });
  }

  /**
   * Alias tương thích ngược cho continueSupervisorRounds
   */
  async continueRounds(
    data: EngineExecutionContext['data'],
    replyMessageId: string,
    prompt: string,
    agents: AvailableAgentDto[],
    history: EngineExecutionContext['history'],
    rounds: SupervisorRoundDto[],
    toolCalls: ToolCallTraceDto[],
    forcedStep?: DelegationDto,
    remainingSteps?: DelegationDto[],
    signal?: AbortSignal,
  ): Promise<AnswerResult> {
    return this.continueSupervisorRounds(
      data,
      replyMessageId,
      prompt,
      agents,
      history,
      rounds,
      toolCalls,
      forcedStep,
      remainingSteps,
      signal,
    );
  }

  // ==========================================
  // HITL & ERROR HANDLING
  // ==========================================

  private async handleExecuteError(
    error: unknown,
    context: EngineExecutionContext,
    connectedProviders: string[],
  ): Promise<AnswerResult> {
    if (error instanceof TurnCancelledError) throw error;

    const priorToolCalls =
      (context.metadata?.priorToolCalls as ToolCallTraceDto[]) ?? [];

    if (error instanceof ClarificationRequiredError) {
      this.logger.warn(
        `[AutonomousEngine] Tạm dừng chờ Clarification HITL: "${error.question}"`,
      );
      return this.pauseForClarification(
        context,
        connectedProviders,
        error.question,
        error.candidates,
        [...priorToolCalls, ...(error.toolCalls ?? [])],
      );
    }

    if (error instanceof ApprovalRequiredError) {
      this.logger.warn(
        `[AutonomousEngine] Tạm dừng chờ HITL approval cho tool "${error.pendingTool.name}"`,
      );
      return this.pauseForApproval(context, connectedProviders, error, priorToolCalls);
    }

    this.logger.error(
      `[AutonomousEngine] Lỗi khi thực thi turn ${context.replyMessageId}: ${(error as Error)?.message}`,
    );
    throw error;
  }

  private async pauseForClarification(
    context: EngineExecutionContext,
    connectedProviders: string[],
    question: string,
    rawCandidates: readonly IClarificationCandidate[],
    toolCalls: ToolCallTraceDto[],
  ): Promise<AnswerResult> {
    const { data, prompt, history } = context;
    this.metrics.incrementBehaviorSignal('clarification_required');
    const candidates: AvailableAgentDto[] = rawCandidates.map((c) => ({
      provider: c.id,
      label: c.label,
      description: c.description ?? '',
    }));

    const paused = await this.checkpointPause.pauseForClarification(
      data,
      prompt,
      [],
      toolCalls,
      history,
      question,
      candidates,
      [],
      EExecutionEngineMode.AUTONOMOUS,
    );
    return this.withAgentStep(paused, prompt, connectedProviders, toolCalls);
  }

  private async pauseForApproval(
    context: EngineExecutionContext,
    connectedProviders: string[],
    error: ApprovalRequiredError,
    priorToolCalls: ToolCallTraceDto[],
  ): Promise<AnswerResult> {
    const { data, prompt, history } = context;
    this.metrics.incrementBehaviorSignal('approval_required');
    const toolCalls = [...priorToolCalls, ...(error.toolCalls ?? [])];

    const approvalNeeded: ApprovalRequiredDelegateResult = {
      approvalRequired: error.pendingTool,
      task: prompt,
      toolCalls,
    };

    const paused = await this.checkpointPause.pauseForApproval(
      data,
      prompt,
      [],
      toolCalls,
      history,
      approvalNeeded,
      [],
      EExecutionEngineMode.AUTONOMOUS,
    );
    return this.withAgentStep(paused, prompt, connectedProviders, toolCalls);
  }

  private withAgentStep(
    paused: AnswerResult,
    prompt: string,
    connectedProviders: string[],
    toolCalls: ToolCallTraceDto[],
  ): AnswerResult {
    return buildAnswer(paused.content, toolCalls, [
      this.buildAgentStep(prompt, connectedProviders, toolCalls),
    ]);
  }

  private buildAgentStep(
    prompt: string,
    connectedProviders: string[],
    toolCalls: ToolCallTraceDto[],
    result?: string,
  ): ExecutedStepDto {
    return {
      agent: this.id,
      task: prompt,
      persona: {
        role: this.name,
        goal: `Thực thi thích ứng tự trị đa công cụ (${connectedProviders.join(', ') || 'compute'})`,
      },
      toolCalls,
      ...(result !== undefined ? { result } : {}),
    };
  }

  // ==========================================
  // RESUME KHÉP KÍN (ReAct hoặc Supervisor)
  // ==========================================

  async resume(checkpoint: CheckpointResponseDto): Promise<AnswerResult> {
    const agents = this.agentDiscovery
      ? await this.agentDiscovery.getAvailableAgents(
          checkpoint.userId,
          checkpoint.workspaceId,
        )
      : this.supervisor
      ? await this.supervisor.getAvailableAgents(
          checkpoint.userId,
          checkpoint.workspaceId,
        )
      : [];

    // Nếu checkpoint thuộc về chu trình Supervisor (có pendingTask, roundsSoFar hoặc remainingSteps)
    const isSupervisorCheckpoint =
      Boolean(checkpoint.pendingTask) ||
      Boolean(checkpoint.roundsSoFar && checkpoint.roundsSoFar.length > 0) ||
      Boolean(checkpoint.remainingSteps && checkpoint.remainingSteps.length > 0) ||
      checkpoint.engineMode === 'dynamic_supervisor';

    if (isSupervisorCheckpoint && this.supervisor && this.streamSink && this.memoryManager) {
      this.logger.log(`[AutonomousEngine] Resume chu trình Dynamic Supervisor cho checkpoint ${checkpoint.id}`);
      return this.resumeSupervisorCheckpoint(checkpoint, agents);
    }

    if (checkpoint.kind === ECheckpointKind.CLARIFICATION) {
      return this.resumeReActClarification(checkpoint, agents);
    }

    if (checkpoint.kind === ECheckpointKind.APPROVAL) {
      return this.resumeReActApproval(checkpoint, agents);
    }

    throw new Error(`[AutonomousEngine] Không hỗ trợ checkpoint kind=${checkpoint.kind}`);
  }

  private async resumeSupervisorCheckpoint(
    checkpoint: CheckpointResponseDto,
    agents: AvailableAgentDto[],
  ): Promise<AnswerResult> {
    const triggerData = {
      userId: checkpoint.userId,
      channelId: checkpoint.channelId,
      workspaceId: checkpoint.workspaceId,
      messageId: checkpoint.replyMessageId,
      botUserId: checkpoint.botUserId,
      channelType: checkpoint.channelType,
      sessionType: checkpoint.sessionType,
      conversationId: checkpoint.conversationId,
    };

    if (checkpoint.kind === ECheckpointKind.CLARIFICATION) {
      const forcedStep: DelegationDto = {
        agent: checkpoint.selectedProvider!,
        task: checkpoint.pendingTask,
      };
      return this.continueSupervisorRounds(
        triggerData,
        checkpoint.replyMessageId,
        checkpoint.originalPrompt,
        agents,
        checkpoint.history,
        checkpoint.roundsSoFar,
        [],
        forcedStep,
        checkpoint.remainingSteps,
      );
    }

    // Approval resume
    const pendingTool = checkpoint.pendingTool!;
    const { resultText, isError } = await executeApprovedTool(
      {
        toolProvider: this.toolProvider!,
        markToolExecuted: this.checkpointService
          ? (dto) => this.checkpointService!.markToolExecuted(dto)
          : undefined,
      },
      checkpoint,
      pendingTool,
    );

    if (isError) {
      return buildAnswer(buildApprovedToolFailureMessage(pendingTool.name, resultText), []);
    }

    const budget = this.memoryManager?.buildBudget(
      process.env.DEFAULT_REACT_MODEL ?? ORCHESTRATION_CONSTANTS.DEFAULT_REACT_MODEL,
    );
    const cappedResult = budget
      ? capToolResultSize(resultText, budget.toolResultCharBudget)
      : resultText;

    const rounds = [
      ...checkpoint.roundsSoFar,
      {
        agent: pendingTool.provider,
        task: checkpoint.pendingTask,
        result: cappedResult,
      },
    ];

    return this.continueSupervisorRounds(
      triggerData,
      checkpoint.replyMessageId,
      checkpoint.originalPrompt,
      agents,
      checkpoint.history,
      rounds,
      [],
      undefined,
      checkpoint.remainingSteps,
    );
  }

  private async resumeReActClarification(
    checkpoint: CheckpointResponseDto,
    agents: AvailableAgentDto[],
  ): Promise<AnswerResult> {
    const selectedAgent = agents.find((a) => a.provider === checkpoint.selectedProvider);
    const candidateLabel = selectedAgent?.label ?? checkpoint.selectedProvider ?? '';
    const clarifiedPrompt = buildClarifiedPrompt(
      checkpoint.originalPrompt,
      candidateLabel,
      checkpoint.selectedProvider,
    );

    const context: EngineExecutionContext = {
      data: {
        userId: checkpoint.userId,
        channelId: checkpoint.conversationId ?? checkpoint.channelId,
        conversationId: checkpoint.conversationId ?? checkpoint.channelId,
        messageId: checkpoint.replyMessageId,
        workspaceId: checkpoint.workspaceId,
        tenantId: checkpoint.workspaceId,
        sessionType: checkpoint.sessionType,
        channelType: checkpoint.channelType,
      },
      replyMessageId: checkpoint.replyMessageId,
      prompt: clarifiedPrompt,
      agents,
      history: checkpoint.history,
      metadata: {
        priorToolCalls: checkpoint.toolCalls ?? [],
      },
    };

    return this.execute(context);
  }

  private async resumeReActApproval(
    checkpoint: CheckpointResponseDto,
    agents: AvailableAgentDto[],
  ): Promise<AnswerResult> {
    const pendingTool = checkpoint.pendingTool;
    if (!pendingTool) {
      throw new Error('[AutonomousEngine] Checkpoint approval thiếu thông tin pendingTool');
    }

    if (!this.toolProvider) {
      throw new Error('[AutonomousEngine] Thiếu toolProvider để thực thi tool đã duyệt');
    }

    const {
      resultText: toolResultText,
      isError,
      trace: executedPendingTool,
    } = await executeApprovedTool(
      {
        toolProvider: this.toolProvider,
        markToolExecuted: this.checkpointService
          ? (dto) => this.checkpointService!.markToolExecuted(dto)
          : undefined,
      },
      checkpoint,
      pendingTool,
    );

    if (isError) {
      return buildAnswer(buildApprovedToolFailureMessage(pendingTool.name, toolResultText), []);
    }

    const priorToolCalls: ToolCallTraceDto[] = [
      ...(checkpoint.toolCalls ?? []),
      executedPendingTool,
    ];

    const followUpPrompt = buildApprovalFollowUpPrompt({
      originalPrompt: checkpoint.originalPrompt,
      provider: pendingTool.provider,
      toolName: pendingTool.name,
      resultText: toolResultText,
    });

    const context: EngineExecutionContext = {
      data: {
        userId: checkpoint.userId,
        channelId: checkpoint.conversationId ?? checkpoint.channelId,
        conversationId: checkpoint.conversationId ?? checkpoint.channelId,
        messageId: checkpoint.replyMessageId,
        workspaceId: checkpoint.workspaceId,
        tenantId: checkpoint.workspaceId,
        sessionType: checkpoint.sessionType,
        channelType: checkpoint.channelType,
      },
      replyMessageId: checkpoint.replyMessageId,
      prompt: followUpPrompt,
      agents,
      history: checkpoint.history,
      metadata: {
        priorToolCalls,
      },
    };

    return this.execute(context);
  }
}
