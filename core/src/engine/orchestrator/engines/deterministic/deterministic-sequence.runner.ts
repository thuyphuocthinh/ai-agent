import { Injectable, Logger } from '@nestjs/common';
import { ORCHESTRATION_CONSTANTS } from '@agent/core/constants';
import {
  AnswerResult,
  ApprovalRequiredDelegateResult,
  buildAnswer,
} from '../../../../contracts/engine/orchestration-answer.types';
import {
  EExecutionEngineMode,
  EngineExecutionContext,
} from '../../../../contracts/engine/execution-engine.interface';
import { DeterministicStepConfig } from '../../../../contracts/engine/deterministic-graph.interface';
import {
  EPipelineStepFailurePolicy,
  EPipelineStepType,
  PipelineDefinition,
} from '../../../../contracts/engine/pipeline-chaining.interface';
import { ReactLoopService } from '../../../loop/react-loop.service';
import { AgentCancellationService } from '../../../cancellation/agent-cancellation.service';
import { assertNotCancelled } from '../../../cancellation/assert-not-cancelled.util';
import { CheckpointPauseService } from '../../../hitl/checkpoint-pause.service';
import { TurnCancelledError } from '../../../loop/errors/turn-cancelled.error';
import { ApprovalRequiredError } from '../../../loop/errors/approval-required.error';
import { ClarificationRequiredError } from '../../../../contracts/engine/clarification-required.error';
import {
  RunReactLoopRequestDto,
  ToolCallTraceDto,
} from '../../../../contracts/dtos/react-loop.dto';
import { ExecutedStepDto } from '../../../../contracts/dtos/message-client.dto';
import { buildReactRequestIdentity } from '../../utils/react-request-identity.util';
import { AvailableAgentDto } from '../../../../contracts/dtos/supervisor.dto';
import { JsonRepair, JsonExtractor } from 'agentic-io-parser';
import { isZodSchema } from '../../../../common/zod.util';
import { buildSchemaCorrectionPrompt } from '../utils/pipeline-prompt.util';

const MAX_STEP_INPUT_CHARS = 50_000;

interface SequenceRunState {
  currentInput: string;
  currentStepIndex: number;
  allToolCalls: ToolCallTraceDto[];
  executedSteps: ExecutedStepDto[];
}

/**
 * DeterministicSequenceRunner
 *
 * Chịu trách nhiệm thực thi Node Chuỗi tuần tự (Sequential DAG / Pipeline) trong Deterministic Engine.
 * Hỗ trợ chuyển giao dữ liệu input/output, condition rẽ nhánh và HITL pause/resume.
 */
@Injectable()
export class DeterministicSequenceRunner {
  private readonly logger = new Logger(DeterministicSequenceRunner.name);
  private readonly jsonRepair = new JsonRepair();
  private readonly jsonExtractor = new JsonExtractor();

  constructor(
    private readonly reactLoop: ReactLoopService,
    private readonly checkpointPause: CheckpointPauseService,
    private readonly cancellation: AgentCancellationService,
  ) {}

  async run(
    steps: readonly DeterministicStepConfig[],
    context: EngineExecutionContext,
    sequenceId: string,
    initialStepIndex = 0,
    initialInput?: string,
    initialExecutedSteps: ExecutedStepDto[] = [],
    initialToolCalls: ToolCallTraceDto[] = [],
  ): Promise<AnswerResult> {
    const { replyMessageId, prompt } = context;
    const state: SequenceRunState = {
      currentInput: initialInput ?? prompt,
      currentStepIndex: initialStepIndex,
      allToolCalls: [...initialToolCalls],
      executedSteps: [...initialExecutedSteps],
    };

    while (state.currentStepIndex < steps.length) {
      await assertNotCancelled(this.cancellation, replyMessageId, context.signal);
      const step = steps[state.currentStepIndex];

      this.logger.log(
        `[DeterministicSequenceRunner: ${sequenceId}] Thực thi step [${state.currentStepIndex + 1}/${steps.length}]: "${step.name}" (${step.id})`,
      );

      const paused = await this.runStep(step, state, context, sequenceId, steps);
      if (paused) return paused;
    }

    return buildAnswer(state.currentInput, state.allToolCalls, state.executedSteps);
  }

  /**
   * Tương thích ngược: thực thi PipelineDefinition trực tiếp
   */
  async executePipeline(
    pipeline: PipelineDefinition,
    context: EngineExecutionContext,
  ): Promise<AnswerResult> {
    const steps: DeterministicStepConfig[] = pipeline.steps.map((s) => ({
      id: s.id,
      name: s.name,
      type: s.type,
      promptTemplate: s.promptTemplate,
      systemPrompt: s.systemPrompt,
      model: s.model,
      tools: s.tools,
      skills: s.skills,
      provider: s.provider,
      outputSchema: s.outputSchema,
      condition: s.condition,
      branchMap: s.branchMap,
      defaultNextStepId: s.defaultNextStepId,
      failurePolicy: s.failurePolicy,
      maxStepRetries: s.maxStepRetries,
      transform: s.transform,
    }));
    return this.run(steps, context, pipeline.id);
  }

  private async runStep(
    step: DeterministicStepConfig,
    state: SequenceRunState,
    context: EngineExecutionContext,
    sequenceId: string,
    allSteps: readonly DeterministicStepConfig[],
  ): Promise<AnswerResult | undefined> {
    if (step.type === EPipelineStepType.CODE_TRANSFORM && step.transform) {
      state.currentInput = await step.transform(
        state.currentInput,
        (context.metadata as Record<string, unknown>) ?? {},
      );
      state.executedSteps.push({
        agent: step.id,
        task: step.name,
        persona: { role: step.name, goal: 'Chuyển đổi dữ liệu bằng logic TS' },
        toolCalls: [],
        result: state.currentInput,
      });
      state.currentStepIndex = this.resolveNextStepIndex(step, state.currentInput, context, allSteps, state.currentStepIndex);
      return undefined;
    }

    const safeInput = this.truncateStepInput(sequenceId, step.id, state.currentInput);
    const stepPrompt = step.promptTemplate
      ? step.promptTemplate.replaceAll('{{input}}', () => safeInput)
      : safeInput;

    const requestDto: RunReactLoopRequestDto = {
      prompt: stepPrompt,
      provider: step.provider ?? (context.agents?.[0]?.provider ?? 'compute'),
      ...buildReactRequestIdentity(context.data),
      messageId: `${context.replyMessageId}:seq:${step.id}`,
      history: [],
      model: step.model ?? process.env.DEFAULT_REACT_MODEL ?? ORCHESTRATION_CONSTANTS.DEFAULT_REACT_MODEL,
      persona: {
        role: step.name,
        goal: step.systemPrompt ?? `Thực hiện bước ${step.name}`,
      },
      allowedTools: step.tools ? [...step.tools] : undefined,
      skills: step.skills ? [...step.skills] : undefined,
      streamKey: context.replyMessageId,
    };

    try {
      const { stepOutput, stepToolCalls } = await this.runStepWithRetry(
        sequenceId,
        step,
        requestDto,
        context.signal,
      );

      state.currentInput = stepOutput;
      if (stepToolCalls.length > 0) {
        state.allToolCalls.push(...stepToolCalls);
      }
      state.executedSteps.push({
        agent: step.id,
        task: step.name,
        persona: { role: step.name, goal: step.systemPrompt ?? step.name },
        toolCalls: stepToolCalls,
        result: state.currentInput,
      });

      state.currentStepIndex = this.resolveNextStepIndex(step, state.currentInput, context, allSteps, state.currentStepIndex);
      return undefined;
    } catch (error) {
      if (error instanceof TurnCancelledError) throw error;

      if (error instanceof ClarificationRequiredError) {
        this.logger.warn(
          `[DeterministicSequenceRunner: ${sequenceId}] Step "${step.id}" cần làm rõ: "${error.question}"`,
        );
        const candidates: AvailableAgentDto[] = error.candidates.map((c) => ({
          provider: c.id,
          label: c.label,
          description: c.description ?? '',
        }));
        return this.checkpointPause.pauseForClarification(
          context.data,
          state.currentInput,
          state.executedSteps.map((s) => ({ agent: s.agent, task: s.task, result: s.result ?? '' })),
          [...state.allToolCalls, ...(error.toolCalls ?? [])],
          context.history,
          error.question,
          candidates,
          [],
          EExecutionEngineMode.DETERMINISTIC,
        );
      }

      if (error instanceof ApprovalRequiredError) {
        this.logger.warn(
          `[DeterministicSequenceRunner: ${sequenceId}] Step "${step.id}" tạm dừng chờ duyệt: "${error.pendingTool.name}"`,
        );
        const approvalNeeded: ApprovalRequiredDelegateResult = {
          approvalRequired: error.pendingTool,
          task: step.name,
          toolCalls: error.toolCalls,
        };
        return this.checkpointPause.pauseForApproval(
          context.data,
          context.prompt,
          state.executedSteps.map((s) => ({ agent: s.agent, task: s.task, result: s.result ?? '' })),
          [...state.allToolCalls, ...(error.toolCalls ?? [])],
          context.history,
          approvalNeeded,
          [],
          EExecutionEngineMode.DETERMINISTIC,
        );
      }

      if (step.failurePolicy === EPipelineStepFailurePolicy.SKIP_AND_CONTINUE) {
        this.logger.warn(`[DeterministicSequenceRunner] Bỏ qua lỗi tại step "${step.id}" do policy SKIP_AND_CONTINUE`);
        state.currentStepIndex++;
        return undefined;
      }

      throw error;
    }
  }

  private resolveNextStepIndex(
    step: DeterministicStepConfig,
    output: string,
    context: EngineExecutionContext,
    allSteps: readonly DeterministicStepConfig[],
    currentIndex: number,
  ): number {
    if (step.condition) {
      try {
        const branchKey = step.condition(output, (context.metadata as Record<string, unknown>) ?? {});
        const targetStepId = typeof branchKey === 'string' && step.branchMap ? step.branchMap[branchKey] ?? branchKey : undefined;
        if (targetStepId) {
          const targetIndex = allSteps.findIndex((s) => s.id === targetStepId);
          if (targetIndex >= 0) return targetIndex;
        }
      } catch (e) {
        this.logger.warn(`[DeterministicSequenceRunner] Lỗi condition tại step "${step.id}": ${(e as Error).message}`);
      }
    }
    if (step.defaultNextStepId) {
      const targetIndex = allSteps.findIndex((s) => s.id === step.defaultNextStepId);
      if (targetIndex >= 0) return targetIndex;
    }
    return currentIndex + 1;
  }

  private truncateStepInput(sequenceId: string, stepId: string, input: string): string {
    if (input.length <= MAX_STEP_INPUT_CHARS) return input;
    this.logger.warn(
      `[DeterministicSequenceRunner: ${sequenceId}] Input step "${stepId}" quá lớn (${input.length} ký tự), cắt về ${MAX_STEP_INPUT_CHARS}`,
    );
    return input.slice(0, MAX_STEP_INPUT_CHARS) + '\n...[Đã cắt bớt do quá độ dài an toàn]';
  }

  private async runStepWithRetry(
    sequenceId: string,
    step: DeterministicStepConfig,
    requestDto: RunReactLoopRequestDto,
    signal?: AbortSignal,
  ): Promise<{ stepOutput: string; stepToolCalls: ToolCallTraceDto[] }> {
    let stepOutput = '';
    let stepToolCalls: ToolCallTraceDto[] = [];
    let executionAttempt = 0;
    const maxRetries =
      step.failurePolicy === EPipelineStepFailurePolicy.RETRY
        ? (step.maxStepRetries ?? 2)
        : 0;

    while (executionAttempt <= maxRetries) {
      executionAttempt++;
      try {
        const result = await this.reactLoop.run(requestDto, signal);
        stepOutput = result.answer;
        stepToolCalls = result.toolCalls ?? [];

        stepOutput = await this.validateAndSelfHealSchema(
          step,
          stepOutput,
          requestDto,
          signal,
        );
        break;
      } catch (runErr) {
        if (
          runErr instanceof TurnCancelledError ||
          runErr instanceof ApprovalRequiredError ||
          runErr instanceof ClarificationRequiredError
        ) {
          throw runErr;
        }
        if (executionAttempt <= maxRetries) {
          this.logger.warn(
            `[DeterministicSequenceRunner: ${sequenceId}] Step "${step.id}" thất bại lần ${executionAttempt}/${maxRetries + 1}, thử lại...`,
          );
          continue;
        }
        throw runErr;
      }
    }
    return { stepOutput, stepToolCalls };
  }

  private async validateAndSelfHealSchema(
    step: DeterministicStepConfig,
    output: string,
    baseRequestDto: RunReactLoopRequestDto,
    signal?: AbortSignal,
  ): Promise<string> {
    if (!step.outputSchema) return output;

    const parsedPayload = this.parseOrRepairJson(output);

    if (isZodSchema(step.outputSchema)) {
      const parseResult = step.outputSchema.safeParse(parsedPayload);
      if (parseResult.success) {
        return typeof parsedPayload === 'string'
          ? parsedPayload
          : JSON.stringify(parsedPayload, null, 2);
      }

      this.logger.warn(
        `[DeterministicSequenceRunner Step: ${step.id}] Output không khớp schema. Kích hoạt 1-shot self-healing...`,
      );

      const correctionPrompt = buildSchemaCorrectionPrompt(
        JSON.stringify(parseResult.error.issues ?? parseResult.error.message),
        output,
      );

      try {
        const healedResult = await this.reactLoop.run(
          {
            ...baseRequestDto,
            prompt: correctionPrompt,
          },
          signal,
        );

        const healedPayload = this.parseOrRepairJson(healedResult.answer);
        const recheck = step.outputSchema.safeParse(healedPayload);
        if (recheck.success) {
          this.logger.log(
            `[DeterministicSequenceRunner Step: ${step.id}] 1-shot self-healing thành công! Output đã hợp lệ.`,
          );
          return JSON.stringify(healedPayload, null, 2);
        }
      } catch (healError) {
        this.logger.warn(
          `[DeterministicSequenceRunner Step: ${step.id}] 1-shot self-healing thất bại: ${(healError as Error)?.message}`,
        );
      }
    }

    return output;
  }

  private parseOrRepairJson(rawText: string): unknown {
    try {
      return JSON.parse(rawText);
    } catch {
      try {
        return this.jsonRepair.repairAndParse(rawText);
      } catch {
        try {
          const extracted = this.jsonExtractor.extract(rawText);
          return this.jsonRepair.repairAndParse(extracted);
        } catch {
          return null;
        }
      }
    }
  }
}
