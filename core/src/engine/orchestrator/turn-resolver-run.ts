import { Logger } from '@nestjs/common';
import { IProcessAiTriggerJobData } from '@agent/core/infrastructure/queue';
import {
  ORCHESTRATION_CONSTANTS,
  ESupervisorVerdict,
  EAgentStreamStepType,
  EAgentStreamStepKind,
} from '@agent/core/constants';
import { ReactLoopService } from '../loop/react-loop.service';
import { ToolRepeatGuard } from '../loop/tool-repeat-guard';
import { SupervisorService } from '../supervisor/supervisor.service';
import { AgentRankingCache } from '../supervisor/supervisor.interface';
import { IStreamSink } from '../../contracts';
import {
  AvailableAgentDto,
  DelegationDto,
  PersonaDto,
  SupervisorRoundDto,
} from '../../contracts/dtos/supervisor.dto';
import { ToolCallTraceDto } from '../../contracts/dtos/react-loop.dto';
import {
  ChatHistoryTurnDto,
  ExecutedStepDto,
} from '../../contracts/dtos/message-client.dto';
import { ApprovalRequiredError } from '../loop/approval-required.error';
import { AgentCancellationService } from '../cancellation/agent-cancellation.service';
import { runCancellable } from '../../common/cancellable-run.util';
import { TurnCancelledError } from '../loop/turn-cancelled.error';
import { describeExternalServiceError } from '../loop/external-service-error.util';
import { CheckpointPauseService } from '../hitl/checkpoint-pause.service';
import { MetricsRegistryService } from '../../common/metrics-registry.service';
import { buildOnToken } from './agent-stream-token.util';
import { capRoundResultsWeighted } from '../../common/token-budget.util';
import { MemoryManagerService } from '../../memory/memory-manager.service';
import { hasPendingActionStep } from '../../common/pending-action-step.util';
import { sanitizePersona } from '../loop/persona-prompt.util';
import {
  buildUngroundedNumbersDisclaimer,
  verifyNumericFactConsistency,
} from '../../security/numeric-fact-consistency.util';
import {
  AnswerResult,
  ApprovalRequiredDelegateResult,
  DelegateRoundResult,
  buildAnswer,
} from './orchestration-answer.types';
import {
  TurnResolverRunDeps,
  TurnResolverRunOptions,
} from './turn-resolver.interface';

const MIN_AGENT_LABEL_LENGTH_FOR_MISMATCH_CHECK = 3;

const GUARDRAIL_BLOCKED_MARKER = 'Bỏ qua bước này';
const REPLAN_MARKER = '[re-plan]';

function isNonProgressRound(round: SupervisorRoundDto): boolean {
  return (
    round.result.startsWith(GUARDRAIL_BLOCKED_MARKER) ||
    round.result.startsWith(REPLAN_MARKER)
  );
}
function buildCancelledPartialText(
  rounds: SupervisorRoundDto[],
  inProgressPartialText?: string,
): string | undefined {
  const doneRounds = rounds.filter((r) => !isNonProgressRound(r));
  const doneParts =
    doneRounds.length === 1
      ? [doneRounds[0].result]
      : doneRounds.map((r, i) => `${i + 1}. ${r.agent}: ${r.result}`);
  if (!inProgressPartialText) {
    return doneParts.length > 0 ? doneParts.join('\n\n') : undefined;
  }
  // Không có round nào TRƯỚC — không cần tiền tố phân biệt, trả nguyên văn.
  if (doneParts.length === 0) return inProgressPartialText;
  return [
    ...doneParts,
    `(đang xử lý dở khi bị dừng) ${inProgressPartialText}`,
  ].join('\n\n');
}

type PlanOutcome =
  | { done: true; answer: AnswerResult }
  | { done: false; steps: DelegationDto[] };

type EvaluateOutcome = ESupervisorVerdict;

/**
 * State + logic của 1 lượt "Plan → delegate → evaluate → synthesize" (1 turn
 * user). Tách khỏi TurnResolverService để state (rounds/toolCalls/counters)
 * là field thay vì phải truyền qua hàng loạt tham số — cùng lý do đã tách
 * ReactLoopRun khỏi ReactLoopService. Xem thiết kế đầy đủ (WHY):
 * docs/orchestration/code-notes/turn-resolver.service.md
 */
export class TurnResolverRun {
  private readonly data: IProcessAiTriggerJobData;
  private readonly replyMessageId: string;
  private readonly prompt: string;
  private readonly agents: AvailableAgentDto[];
  private readonly history: ChatHistoryTurnDto[];
  private readonly rounds: SupervisorRoundDto[];
  private readonly toolCalls: ToolCallTraceDto[];
  private readonly executionSteps: ExecutedStepDto[] = [];
  private readonly signal?: AbortSignal;
  // Kết quả các round ĐÃ CÓ trước khi lượt chạy này bắt đầu (resume sau HITL:
  // toolCalls bắt đầu rỗng nhưng rounds mang kết quả cũ) — chỉ chúng mới được
  // dùng làm nguồn đối soát số liệu; round chạy trong lượt này đối soát bằng
  // output tool thật, không bằng chính lời tóm tắt của worker.
  private readonly priorRoundResults: string[];

  private readonly repeatGuard = new ToolRepeatGuard();

  private readonly reactLoop: ReactLoopService;
  private readonly supervisor: SupervisorService;
  private readonly streamSink: IStreamSink;
  private get agentStream(): IStreamSink {
    return this.streamSink;
  }
  private readonly cancellation: AgentCancellationService;
  private readonly checkpointPause: CheckpointPauseService;
  private readonly metrics: MetricsRegistryService;
  private readonly memoryManager: MemoryManagerService;
  private readonly logger: Logger;

  private nonProgressRounds: number;
  private realStepsRun: number;

  constructor(options: TurnResolverRunOptions, deps: TurnResolverRunDeps) {
    this.data = options.data;
    this.replyMessageId = options.replyMessageId;
    this.prompt = options.prompt;
    this.agents = options.agents;
    this.history = options.history;
    this.rounds = options.rounds;
    this.priorRoundResults = options.rounds.map((r) => r.result);
    this.toolCalls = options.toolCalls;
    this.signal = options.signal;

    this.reactLoop = deps.reactLoop;
    this.supervisor = deps.supervisor;
    this.streamSink = (deps.streamSink ?? deps.agentStream)!;
    this.cancellation = deps.cancellation;
    this.checkpointPause = deps.checkpointPause;
    this.metrics = deps.metrics;
    this.memoryManager = deps.memoryManager;
    this.logger = deps.logger;

    this.nonProgressRounds = this.rounds.filter(isNonProgressRound).length;
    this.realStepsRun = this.rounds.length - this.nonProgressRounds;
  }

  async run(
    forcedStep?: DelegationDto,
    remainingSteps?: DelegationDto[],
  ): Promise<AnswerResult> {
    let steps: DelegationDto[] = forcedStep
      ? [forcedStep, ...(remainingSteps ?? [])]
      : (remainingSteps ?? []);
    let needsPlan = !forcedStep && remainingSteps === undefined;
    const agentRankingCache: AgentRankingCache = {};

    if (!forcedStep && remainingSteps !== undefined && this.rounds.length > 0) {
      const resumeOutcome = await this.handleResumeEvaluation(steps);
      if (resumeOutcome.done) return resumeOutcome.answer;
      steps = resumeOutcome.steps;
      needsPlan = resumeOutcome.needsPlan;
    }

    while (
      this.realStepsRun < ORCHESTRATION_CONSTANTS.MAX_REAL_STEPS_PER_TURN &&
      this.nonProgressRounds < ORCHESTRATION_CONSTANTS.MAX_SUPERVISOR_ROUNDS
    ) {
      await this.throwIfCancelled();

      if (needsPlan) {
        const planOutcome = await this.runPlanningStep(agentRankingCache);
        if (planOutcome.done) return planOutcome.answer;
        steps = planOutcome.steps;
        needsPlan = false;
      }

      if (steps.length === 0) {
        return this.finalizeAnswer();
      }

      const firstStage = steps[0]?.stage;
      let batch: DelegationDto[];
      if (firstStage === undefined) {
        batch = [steps.shift()!];
      } else {
        const splitIdx = steps.findIndex((s) => s.stage !== firstStage);
        if (splitIdx === -1) {
          batch = steps.splice(0);
        } else {
          batch = steps.splice(0, splitIdx);
        }
      }
      if (batch.some((s) => this.guardAgainstMisroute(s))) {
        needsPlan = true;
        steps = [];
        continue;
      }

      const batchOutcome = await this.executeStageBatch(batch, steps);
      if (batchOutcome.done) return batchOutcome.answer;
      if (batchOutcome.replan) {
        needsPlan = true;
        steps = [];
      }
    }

    return this.runNonConvergenceFallback();
  }

  private async throwIfCancelled(): Promise<void> {
    if (
      this.signal?.aborted ||
      (await this.cancellation.isCancelled(this.replyMessageId))
    ) {
      throw new TurnCancelledError(buildCancelledPartialText(this.rounds));
    }
  }

  /** Resume sau khi duyệt 1 hành động — evaluate() lại bước VỪA xong trước
   * khi tiếp tục, y hệt như nếu turn chưa từng dừng lại chờ duyệt. */
  private async handleResumeEvaluation(
    steps: DelegationDto[],
  ): Promise<
    | { done: true; answer: AnswerResult }
    | { done: false; steps: DelegationDto[]; needsPlan: boolean }
  > {
    const lastRound = this.rounds[this.rounds.length - 1];
    const outcome = await this.runEvaluateAndDecide(lastRound, steps, true);
    if (outcome === 'finalize') {
      return { done: true, answer: await this.finalizeAnswer() };
    }
    if (outcome === 'replan') {
      this.nonProgressRounds++;
      this.metrics.incrementBehaviorSignal('replan');
      this.rounds.push({
        agent: lastRound.agent,
        task: lastRound.task,
        result: `${REPLAN_MARKER} evaluate() cho rằng bước vừa xong không đạt kỳ vọng, đã lập lại kế hoạch.`,
      });
      return { done: false, steps: [], needsPlan: true };
    }
    return { done: false, steps, needsPlan: false };
  }

  private async runPlanningStep(
    agentRankingCache: AgentRankingCache,
  ): Promise<PlanOutcome> {
    const { userId } = this.data;
    const conversationId = this.data.conversationId ?? this.data.channelId;
    const sessionType = this.data.sessionType ?? this.data.channelType ?? 'direct';
    await this.agentStream
      .emitStep(
        {
          userId,
          conversationId,
          channelId: conversationId,
          messageId: this.replyMessageId,
          sessionType,
          channelType: sessionType,
        },
        {
          type: EAgentStreamStepType.STEP_START,
          label: '🧠 Đang phân tích yêu cầu và lập kế hoạch...',
          kind: EAgentStreamStepKind.PLANNING,
        },
      )
      .catch(() => {});

    const plan = await this.supervisor.plan(
      this.prompt,
      this.agents,
      this.rounds,
      this.history,
      agentRankingCache,
      this.signal,
      conversationId,
      this.data.workspaceId,
    );

    if (plan.action === 'respond') {
      if (plan.rememberFact) {
        this.memoryManager
          .recordUserDeclaredFact(
            conversationId,
            this.replyMessageId,
            plan.rememberFact,
          )
          .catch((error) =>
            this.logger.warn(
              `recordUserDeclaredFact() failed: ${(error as Error).message}`,
            ),
          );
      }
      const answerHint =
        plan.answer ||
        (plan.rememberFact
          ? `Mình đã ghi nhớ: ${plan.rememberFact}.`
          : plan.answer);
      return { done: true, answer: await this.finalizeAnswer(answerHint) };
    }

    const steps = plan.steps ?? [];

    steps.forEach((s) => {
      const safeAgent = s.agent || '';
      const matchedAgent = this.agents.find(
        (a) =>
          a.provider === safeAgent ||
          a.label.toLowerCase() === safeAgent.toLowerCase() ||
          a.label.toLowerCase().replace(/[^a-z0-9]/g, '') ===
            safeAgent.toLowerCase().replace(/[^a-z0-9]/g, ''),
      );
      if (matchedAgent && matchedAgent.provider !== s.agent) {
        s.agent = matchedAgent.provider;
      }
    });

    if (steps.every((s) => !this.agents.some((a) => a.provider === s.agent))) {
      const attemptedAgents = steps.map((s) => s.agent || 'unknown').join(', ');
      return {
        done: true,
        answer: buildAnswer(
          plan.answer ||
            `Mình chưa thể xử lý yêu cầu này với các kết nối hiện có (Tên hệ thống mà AI đang cố gọi: "${attemptedAgents}" - Vui lòng đổi tên hoặc viết đúng tên). Vào Settings để kết nối agent phù hợp nhé.`,
          this.toolCalls,
          this.executionSteps,
        ),
      };
    }
    if (
      process.env.ENABLE_CLARIFICATION_HITL === 'true' &&
      plan.ambiguousCandidates?.some((c) => c.provider === steps[0]?.agent)
    ) {
      this.metrics.incrementBehaviorSignal('clarification_required');
      return {
        done: true,
        answer: await this.checkpointPause.pauseForClarification(
          this.data,
          this.prompt,
          this.rounds,
          this.toolCalls,
          this.history,
          steps[0].task,
          plan.ambiguousCandidates,
          steps.slice(1),
        ),
      };
    }

    return { done: false, steps };
  }

  /** true nghĩa là ĐÃ push round guardrail + cần re-plan — gọi nơi gọi tự
   * reset steps/needsPlan rồi continue vòng lặp. */
  private guardAgainstMisroute(step: DelegationDto): boolean {
    const misroutedTo = this.findLikelyMisroutedAgent(step);
    if (!misroutedTo) return false;

    this.logger.warn(
      `Guardrail: bước chọn agent "${step.agent}" nhưng task nhắc rõ hệ thống "${misroutedTo.label}" (provider "${misroutedTo.provider}") — nghi ngờ chọn sai, re-plan sớm thay vì thực thi mù.`,
    );
    this.rounds.push({
      agent: step.agent,
      task: step.task,
      result: `${GUARDRAIL_BLOCKED_MARKER} — kế hoạch chọn hệ thống "${step.agent}" nhưng yêu cầu nhắc rõ tới hệ thống "${misroutedTo.label}" (đã kết nối, provider "${misroutedTo.provider}") — có khả năng chọn sai agent, cần lập lại kế hoạch.`,
    });
    this.nonProgressRounds++;
    this.metrics.incrementBehaviorSignal('misroute_guardrail');
    return true;
  }

  private async executeStageBatch(
    batch: DelegationDto[],
    remainingSteps: DelegationDto[],
  ): Promise<
    { done: true; answer: AnswerResult } | { done: false; replan: boolean }
  > {
    const startRealSteps = this.realStepsRun;
    const results = await Promise.all(
      batch.map((step, idx) =>
        this.delegateRound(step, startRealSteps + idx, [
          ...batch.filter((_, i) => i !== idx),
          ...remainingSteps,
        ]),
      ),
    );

    const approvalIdx = results.findIndex(
      (r) => r && 'approvalRequired' in r,
    );
    if (approvalIdx !== -1) {
      for (let i = 0; i < approvalIdx; i++) {
        const s = batch[i];
        const res = results[i] as DelegateRoundResult | null;
        this.rounds.push(
          res?.round ?? {
            agent: s.agent,
            task: s.task,
            result:
              'Agent này chưa khả dụng (chưa kết nối hoặc chưa có hạ tầng) — bỏ qua, không thực hiện được phần việc này.',
          },
        );
        if (res) this.toolCalls.push(...res.toolCalls);
        this.executionSteps.push({
          agent: s.agent,
          task: s.task,
          persona: sanitizePersona(s.persona),
          toolCalls: res?.toolCalls ?? [],
          result: res?.round?.result,
        });
      }

      const approvalResult = results[approvalIdx] as ApprovalRequiredDelegateResult;
      const pendingStep = batch[approvalIdx];
      const unexecutedSteps = [...batch.slice(approvalIdx + 1), ...remainingSteps];

      this.realStepsRun = startRealSteps + approvalIdx + 1;
      this.toolCalls.push(...approvalResult.toolCalls);
      this.executionSteps.push({
        agent: pendingStep.agent,
        task: pendingStep.task,
        persona: sanitizePersona(pendingStep.persona),
        toolCalls: approvalResult.toolCalls,
      });
      const preApproval = this.buildPreApprovalRound(
        pendingStep,
        approvalResult.toolCalls,
      );
      if (preApproval) this.rounds.push(preApproval);

      this.metrics.incrementBehaviorSignal('approval_required');
      return {
        done: true,
        answer: await this.checkpointPause.pauseForApproval(
          this.data,
          this.prompt,
          this.rounds,
          this.toolCalls,
          this.history,
          approvalResult,
          unexecutedSteps,
        ),
      };
    }

    this.realStepsRun = startRealSteps + batch.length;

    for (let i = 0; i < batch.length; i++) {
      const step = batch[i];
      const result = results[i] as DelegateRoundResult | null;
      let completedRound: SupervisorRoundDto;
      if (result) {
        completedRound = result.round;
      } else {
        completedRound = {
          agent: step.agent,
          task: step.task,
          result:
            'Agent này chưa khả dụng (chưa kết nối hoặc chưa có hạ tầng) — bỏ qua, không thực hiện được phần việc này.',
        };
      }

      this.rounds.push(completedRound);
      if (result) this.toolCalls.push(...result.toolCalls);
      this.executionSteps.push({
        agent: step.agent,
        task: step.task,
        persona: sanitizePersona(step.persona),
        toolCalls: result?.toolCalls ?? [],
        result: completedRound.result,
      });
    }

    const lastRound = this.rounds[this.rounds.length - 1];
    const outcome = await this.runEvaluateAndDecide(lastRound, remainingSteps);

    if (outcome === 'finalize') {
      return { done: true, answer: await this.finalizeAnswer() };
    }
    if (outcome === 'replan') {
      this.nonProgressRounds++;
      this.metrics.incrementBehaviorSignal('replan');
      this.rounds.push({
        agent: lastRound.agent,
        task: lastRound.task,
        result: `${REPLAN_MARKER} evaluate() cho rằng bước vừa xong không đạt kỳ vọng, đã lập lại kế hoạch.`,
      });
      return { done: false, replan: true };
    }

    return { done: false, replan: false };
  }

  private async runNonConvergenceFallback(): Promise<AnswerResult> {
    const { userId } = this.data;
    const conversationId = this.data.conversationId ?? this.data.channelId;
    const sessionType = this.data.sessionType ?? this.data.channelType ?? 'direct';
    this.logger.warn(
      `Supervisor chưa hội tụ (realSteps=${this.realStepsRun}/${ORCHESTRATION_CONSTANTS.MAX_REAL_STEPS_PER_TURN}, nonProgress=${this.nonProgressRounds}/${ORCHESTRATION_CONSTANTS.MAX_SUPERVISOR_ROUNDS}) cho user ${userId}, tổng hợp lại kết quả đã có`,
    );
    this.metrics.incrementBehaviorSignal('non_convergence');
    await this.agentStream
      .emitStep(
        {
          userId,
          conversationId,
          channelId: conversationId,
          messageId: this.replyMessageId,
          sessionType,
          channelType: sessionType,
        },
        {
          type: EAgentStreamStepType.STEP_START,
          label: 'Tổng hợp câu trả lời',
          kind: EAgentStreamStepKind.SYNTHESIZE,
        },
      )
      .catch(() => {});
    const fallbackAccumulator = { text: '' };
    const finalAnswer = await runCancellable(
      this.replyMessageId,
      this.cancellation,
      (sig) =>
        this.supervisor.synthesize(
          this.prompt,
          this.rounds,
          buildOnToken(
            this.agentStream,
            userId,
            conversationId,
            this.replyMessageId,
            sessionType,
            fallbackAccumulator,
          ),
          sig,
        ),
      () =>
        new TurnCancelledError(
          buildCancelledPartialText(this.rounds, fallbackAccumulator.text),
        ),
      this.signal,
    );
    return buildAnswer(
      await this.appendDisclaimers(finalAnswer),
      this.toolCalls,
      this.executionSteps,
    );
  }

  private async finalizeAnswer(answerHint?: string): Promise<AnswerResult> {
    const { userId } = this.data;
    const conversationId = this.data.conversationId ?? this.data.channelId;
    const sessionType = this.data.sessionType ?? this.data.channelType ?? 'direct';

    if (this.rounds.length === 1) {
      return buildAnswer(
        await this.appendDisclaimers(this.rounds[0].result),
        this.toolCalls,
        this.executionSteps,
      );
    }
    if (this.rounds.length > 1) {
      await this.agentStream
        .emitStep(
          {
            userId,
            conversationId,
            channelId: conversationId,
            messageId: this.replyMessageId,
            sessionType,
            channelType: sessionType,
          },
          {
            type: EAgentStreamStepType.STEP_START,
            label: 'Tổng hợp câu trả lời',
            kind: EAgentStreamStepKind.SYNTHESIZE,
          },
        )
        .catch(() => {});
      const accumulator = { text: '' };
      const finalAnswer = await runCancellable(
        this.replyMessageId,
        this.cancellation,
        (sig) =>
          this.supervisor.synthesize(
            this.prompt,
            this.rounds,
            buildOnToken(
              this.agentStream,
              userId,
              conversationId,
              this.replyMessageId,
              sessionType,
              accumulator,
            ),
            sig,
          ),
        () =>
          new TurnCancelledError(
            buildCancelledPartialText(this.rounds, accumulator.text),
          ),
        this.signal,
      );
      return buildAnswer(
        await this.appendDisclaimers(finalAnswer),
        this.toolCalls,
        this.executionSteps,
      );
    }
    return buildAnswer(
      answerHint || 'Xin lỗi, mình chưa có câu trả lời phù hợp.',
      this.toolCalls,
      this.executionSteps,
    );
  }

  // Gắn các cảnh báo vào câu trả lời cuối. Số liệu phải được đối soát TRƯỚC khi
  // cảnh báo số lượng được nối vào, kẻo chính các con số trong cảnh báo đó bị
  // coi là chưa có nguồn.
  private async appendDisclaimers(answer: string): Promise<string> {
    const numericDisclaimer = this.buildUngroundedNumbersDisclaimer(answer);
    const withQuantity = await this.appendCumulativeQuantityDisclaimer(answer);
    return numericDisclaimer
      ? `${withQuantity}\n\n${numericDisclaimer}`
      : withQuantity;
  }

  // Chống ảo giác số liệu (AC-6): mọi con số trong câu trả lời phải có trong
  // prompt, lịch sử, kết quả round cũ (resume) hoặc output tool thật của turn.
  // Chỉ cảnh báo, không chặn. Bỏ qua khi turn không gọi tool nào (không có nguồn
  // dữ liệu thật để đối soát — câu trả lời đến từ kiến thức của model).
  private buildUngroundedNumbersDisclaimer(answer: string): string | null {
    if (this.toolCalls.length === 0) return null;

    const { ungrounded } = verifyNumericFactConsistency(answer, [
      this.prompt,
      ...this.history.map((turn) => turn.text),
      ...this.priorRoundResults,
      ...this.toolCalls.map((call) => call.resultPreview ?? ''),
    ]);
    if (ungrounded.length === 0) return null;

    this.logger.warn(
      `[numeric-fact-consistency] ${ungrounded.length} số trong câu trả lời không có trong nguồn: ${ungrounded.join(', ')}`,
    );
    return buildUngroundedNumbersDisclaimer(ungrounded);
  }

  // HH1 (manual_test_bank_heavy.md) — Fix #3 (react-loop-run.ts) chỉ so
  // required/achieved TRONG 1 ReactLoopService.run(); khi Supervisor tách
  // nhiều step cho CÙNG 1 yêu cầu số lượng, mỗi step tự thấy đủ cục bộ dù
  // TỔNG cả turn đã lệch. Check lại 1 lần CUỐI ở đây bằng resultPreview của
  // TOÀN BỘ toolCalls turn (this.toolCalls đã cộng dồn qua mọi step/resume).
  // Bỏ qua (không tốn thêm LLM call) nếu turn không có tool call thật nào.
  private async appendCumulativeQuantityDisclaimer(
    answer: string,
  ): Promise<string> {
    if (this.toolCalls.length === 0) return answer;

    const { requiredCount, achievedCount } =
      await this.supervisor.checkCumulativeQuantity(
        this.prompt,
        this.toolCalls,
        this.signal,
      );
    if (requiredCount > 0 && achievedCount !== requiredCount) {
      return `${answer}\n\n⚠️ Yêu cầu cần xử lý đúng ${requiredCount}, nhưng theo kết quả tool THẬT chỉ xác nhận được ${achievedCount}.`;
    }
    return answer;
  }

  private async runEvaluateAndDecide(
    completedRound: SupervisorRoundDto,
    remainingSteps: DelegationDto[],
    forceEvaluate = false,
  ): Promise<EvaluateOutcome> {
    const hasPendingAction = hasPendingActionStep(remainingSteps);
    const roundHasError =
      completedRound.result.includes('Lỗi') ||
      completedRound.result.includes('Error') ||
      completedRound.result.includes('chưa khả dụng');

    if (!forceEvaluate && hasPendingAction && !roundHasError) {
      this.logger.log(
        `runEvaluateAndDecide: fast-path skipping evaluate() because remaining steps have pending actions (${remainingSteps.length} steps left)`,
      );
      return ESupervisorVerdict.CONTINUE;
    }

    const verdict = await this.supervisor.evaluate(
      this.prompt,
      completedRound,
      remainingSteps,
      this.signal,
    );
    if (verdict.verdict === ESupervisorVerdict.DONE) {
      if (!hasPendingActionStep(remainingSteps)) {
        return ESupervisorVerdict.FINALIZE;
      }
      this.logger.warn(
        `evaluate() trả 'done' nhưng còn bước HÀNH ĐỘNG/KIỂM TRA chưa chạy (${remainingSteps.map((s) => s.task).join('; ')}) — bác bỏ 'done', tiếp tục chạy nốt kế hoạch.`,
      );
      return ESupervisorVerdict.CONTINUE;
    }
    if (verdict.verdict === ESupervisorVerdict.REPLAN) {
      return ESupervisorVerdict.REPLAN;
    }
    return ESupervisorVerdict.CONTINUE;
  }

  private buildPreApprovalRound(
    step: DelegationDto,
    toolCallsBeforeBlock: ToolCallTraceDto[],
  ): SupervisorRoundDto | null {
    const successful = toolCallsBeforeBlock.filter(
      (tc) => tc.status === 'success',
    );
    if (successful.length === 0) return null;

    const result = successful
      .map((tc) => `${tc.tool}: ${tc.resultPreview ?? '(không có nội dung)'}`)
      .join('\n');
    return {
      agent: step.agent,
      task: `${step.task} (dữ liệu đã thu thập được TRƯỚC KHI cần duyệt 1 hành động khác trong cùng bước này)`,
      result,
    };
  }

  private findLikelyMisroutedAgent(
    step: DelegationDto,
  ): AvailableAgentDto | null {
    const chosenAgent = this.agents.find((a) => a.provider === step.agent);
    if (!chosenAgent) return null;

    const taskLower = (step.task ?? '').toLowerCase();
    if (taskLower.includes(chosenAgent.label.toLowerCase())) return null;

    return (
      this.agents.find(
        (a) =>
          a.provider !== step.agent &&
          a.label.length >= MIN_AGENT_LABEL_LENGTH_FOR_MISMATCH_CHECK &&
          taskLower.includes(a.label.toLowerCase()),
      ) ?? null
    );
  }

  private async delegateRound(
    delegation: DelegationDto,
    round: number,
    remainingSteps: DelegationDto[],
  ): Promise<DelegateRoundResult | ApprovalRequiredDelegateResult | null> {
    const { userId } = this.data;
    const conversationId = this.data.conversationId ?? this.data.channelId;
    const workspaceId = this.data.tenantId ?? this.data.workspaceId ?? 'default';
    const sessionType = this.data.sessionType ?? this.data.channelType ?? 'direct';
    const targetAgent = this.agents.find(
      (a) => a.provider === delegation.agent,
    );

    if (!targetAgent) {
      this.logger.warn(
        `Supervisor delegated to unknown/unavailable agent "${delegation.agent}" for user ${userId}`,
      );
      return null;
    }

    const task = delegation.task || this.prompt;
    const reactModelId =
      process.env.DEFAULT_REACT_MODEL ??
      ORCHESTRATION_CONSTANTS.DEFAULT_REACT_MODEL;
    const realRoundsSoFar = this.rounds.filter((r) => !isNonProgressRound(r));
    const contextBlocks: string[] = [task];
    if (task !== this.prompt) {
      // Chỉ khi kế hoạch còn bước khác (đã chạy hoặc sắp chạy) mới giới hạn phạm vi:
      // không có dòng này, worker thấy cả yêu cầu gốc và làm luôn phần của các bước kia
      // (bước 1 gọi đủ SQL cho cả 4 bước), khiến các bước sau chỉ chép lại nhau.
      const scopeNote =
        remainingSteps.length > 0 || realRoundsSoFar.length > 0
          ? ' CHỈ thực hiện phần việc trong task ở trên; các phần khác của yêu cầu gốc là việc của CÁC BƯỚC KHÁC trong kế hoạch — KHÔNG làm thay, KHÔNG gọi tool cho phần đó.'
          : '';
      contextBlocks.push(
        `Yêu cầu gốc đầy đủ của user cho turn này (dùng để lấy đúng dữ liệu/số liệu cụ thể nếu task ở trên chỉ tóm tắt lại, TUYỆT ĐỐI không tự bịa dữ liệu khi task tóm tắt bị thiếu).${scopeNote}\n${this.prompt}`,
      );
    }
    if (realRoundsSoFar.length > 0) {
      contextBlocks.push(
        `Dữ liệu THẬT đã thu thập được từ (các) bước trước trong CÙNG yêu cầu này (PHẢI dùng ĐÚNG NGUYÊN VĂN, không tự bịa/diễn giải lại số liệu):\n${capRoundResultsWeighted(
          realRoundsSoFar,
          this.memoryManager.buildBudget(reactModelId).toolResultCharBudget,
        )
          .map(
            (r, i) =>
              `${i + 1}. Agent "${r.agent}" (yêu cầu: "${r.task}") → kết quả: ${r.result}`,
          )
          .join('\n')}`,
      );
    }
    const promptWithContext = contextBlocks.join('\n\n');
    const streamKey = `r${round}-${targetAgent.provider}`;
    // Persona do LLM sinh nên sanitize trước khi đưa ra client (giống khi tiêm prompt).
    const persona = sanitizePersona(delegation.persona);
    await this.agentStream
      .emitStep(
        {
          userId,
          conversationId,
          channelId: conversationId,
          messageId: this.replyMessageId,
          sessionType,
          channelType: sessionType,
          streamKey,
        },
        {
          type: EAgentStreamStepType.STEP_START,
          label: `${targetAgent.label}: ${task}`,
          ...(persona ? { persona } : {}),
        },
      )
      .catch(() => {});
    try {
      const { answer, toolCalls } = await this.reactLoop.run(
        {
          prompt: promptWithContext,
          provider: targetAgent.provider,
          userId,
          conversationId,
          channelId: conversationId,
          workspaceId,
          messageId: this.replyMessageId,
          sessionType,
          channelType: sessionType,
          history: this.history,
          streamKey,
          persona: delegation.persona,
        },
        this.signal,
        this.repeatGuard,
      );
      return {
        round: { agent: targetAgent.provider, task, result: answer },
        toolCalls,
      };
    } catch (error) {
      if (error instanceof TurnCancelledError) {
        // ReactLoop's own partialText chỉ là phần dở của round NÀY — gộp
        // thêm các round TRƯỚC đã xong (xem buildCancelledPartialText).
        throw new TurnCancelledError(
          buildCancelledPartialText(this.rounds, error.partialText),
        );
      }
      if (error instanceof ApprovalRequiredError) {
        return {
          approvalRequired: error.pendingTool,
          task,
          toolCalls: error.toolCalls,
        };
      }
      this.logger.error(
        `ReactLoop failed for agent "${targetAgent.provider}": ${(error as Error).message}`,
        (error as Error).stack,
      );
      return {
        round: {
          agent: targetAgent.provider,
          task,
          result: describeExternalServiceError(error),
        },
        toolCalls: [],
      };
    }
  }
}
