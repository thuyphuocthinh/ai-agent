import { Injectable, Logger, Inject, Optional } from '@nestjs/common';
import {
  DEFAULT_PIPELINE_DESCRIPTION,
  DEFAULT_TWO_STEP_PIPELINE_ID,
  EXTRACT_STEP_PROMPT_TEMPLATE,
  EXTRACT_STEP_SYSTEM_PROMPT,
  ORCHESTRATION_CONSTANTS,
  EStepExecutionStatus,
  SYNTHESIZE_STEP_PROMPT_TEMPLATE,
  SYNTHESIZE_STEP_SYSTEM_PROMPT,
} from '@agent/core/constants';
import { buildSchemaCorrectionPrompt } from './utils/pipeline-prompt.util';
import { buildApprovedToolFailureMessage } from './utils/engine-prompt.util';
import {
  EngineRoutingContext,
  EngineExecutionContext,
  EExecutionEngineMode,
} from '../../../contracts/engine/execution-engine.interface';
import {
  IPipelineChainingEngine,
  PipelineDefinition,
  PipelineStepDefinition,
  EPipelineStepType,
  EPipelineStepFailurePolicy,
} from '../../../contracts/engine/pipeline-chaining.interface';
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
import { JsonRepair, JsonExtractor } from 'agentic-io-parser';
import { isZodSchema } from '../../../common/zod.util';
import {
  RunReactLoopRequestDto,
  ToolCallTraceDto,
} from '../../../contracts/dtos/react-loop.dto';
import { ExecutedStepDto } from '../../../contracts/dtos/message-client.dto';
import { TOOL_PROVIDER, IToolProvider } from '../../../contracts';
import { extractTextFromMcpResult } from '../../../common';
import { buildReactRequestIdentity } from '../utils/react-request-identity.util';
import { CheckpointResponseDto } from '../../../contracts/dtos/checkpoint.dto';
import { PendingToolCall } from '../../../contracts';

const PIPELINE_INTENT_REGEX =
  /(quy trình|pipeline|báo cáo tuần|onboarding|theo các bước tuần tự|bước 1.*bước 2|chaining)/i;

/**
 * PipelineChainingEngine
 *
 * Engine thực thi Pipeline Chaining tuần tự & rẽ nhánh điều kiện (Nhánh 2 trong Master Blueprint).
 *
 * Hardened Features:
 * - Step Output Schema Validation: Kiểm tra hợp lệ bằng Zod/JSON Schema, tự động kích hoạt 1-shot self-healing correction prompt.
 * - Dynamic Conditional Branching: Hỗ trợ rẽ nhánh IF/ELSE thông qua `condition` & `branchMap` thay vì chỉ đi đường thẳng.
 * - Step Failure Policies: Hỗ trợ STOP_ON_FAILURE, SKIP_AND_CONTINUE, và RETRY với giới hạn cứng tối đa 2 lần.
 * - Buffer Truncation Guard: Giới hạn an toàn 50.000 ký tự cho input giữa các bước.
 */
@Injectable()
export class PipelineChainingEngine implements IPipelineChainingEngine {
  readonly id = EExecutionEngineMode.PIPELINE_CHAINING;
  readonly name = 'Pipeline Chaining Engine (Sequential DAG)';
  readonly priority = 20;

  private readonly logger = new Logger(PipelineChainingEngine.name);
  private readonly pipelines = new Map<string, PipelineDefinition>();
  private readonly jsonRepair = new JsonRepair();
  private readonly jsonExtractor = new JsonExtractor();

  constructor(
    private readonly reactLoop: ReactLoopService,
    private readonly cancellation: AgentCancellationService,
    private readonly checkpointPause: CheckpointPauseService,
    private readonly metrics: MetricsRegistryService,
    @Optional()
    @Inject(TOOL_PROVIDER)
    private readonly toolProvider?: IToolProvider,
  ) {
    this.registerBuiltInPipelines();
  }

  registerPipeline(pipeline: PipelineDefinition): void {
    if (!pipeline?.id) {
      throw new Error('[PipelineChainingEngine] Pipeline id là bắt buộc');
    }
    this.pipelines.set(pipeline.id, pipeline);
    this.logger.log(
      `Đã đăng ký pipeline "${pipeline.id}" (${pipeline.name}) [${pipeline.steps.length} steps]`,
    );
  }

  getPipeline(id: string): PipelineDefinition | undefined {
    return this.pipelines.get(id);
  }

  hasPipeline(id: string): boolean {
    return this.pipelines.has(id);
  }

  canHandle(context: EngineRoutingContext): boolean {
    if (context.forcedMode === 'pipeline') return true;
    if (context.forcedMode && context.forcedMode !== 'auto') return false;

    if (context.workflowId && this.hasPipeline(context.workflowId)) {
      return true;
    }

    if (context.metadata?.pipeline) {
      return true;
    }

    return PIPELINE_INTENT_REGEX.test(context.prompt);
  }

  async execute(context: EngineExecutionContext): Promise<AnswerResult> {
    const pipeline = this.resolvePipeline(context);
    return this.executePipeline(pipeline, context);
  }

  async executePipeline(
    pipeline: PipelineDefinition,
    context: EngineExecutionContext,
    startIndex = 0,
    initialInput?: string,
    initialExecutedSteps: ExecutedStepDto[] = [],
    initialToolCalls: ToolCallTraceDto[] = [],
  ): Promise<AnswerResult> {
    const { data, replyMessageId, prompt, agents, history, signal } = context;
    const connectedProviders = (agents ?? []).map((a) => a.provider);
    const primaryProvider = connectedProviders[0] ?? 'compute';

    this.logger.log(
      `Bắt đầu thực thi pipeline "${pipeline.id}" (${pipeline.name}) cho turn ${replyMessageId} [${pipeline.steps.length} steps, startIndex=${startIndex}]`,
    );

    let currentInput = initialInput ?? prompt;
    const allToolCalls: ToolCallTraceDto[] = [...initialToolCalls];
    const executedSteps: ExecutedStepDto[] = [...initialExecutedSteps];
    let currentStepIndex = startIndex;
    const executedStepIds = new Set<string>(executedSteps.map((s) => s.agent));

    while (currentStepIndex < pipeline.steps.length) {
      const step = pipeline.steps[currentStepIndex];

      // Chống lặp vô tận do rẽ nhánh vòng lặp
      if (executedStepIds.has(step.id)) {
        this.logger.warn(
          `[Pipeline: ${pipeline.id}] Step "${step.id}" đã được thực thi trước đó, dừng lại để tránh vòng lặp vô hạn.`,
        );
        break;
      }
      executedStepIds.add(step.id);

      // 1. Kiểm tra cờ hủy
      await assertNotCancelled(this.cancellation, replyMessageId, signal);

      this.logger.log(
        `[Pipeline: ${pipeline.id}] Đang thực thi Step: "${step.name}" (id=${step.id}, model=${step.model ?? 'default'})`,
      );

      // 3. Xử lý Step chuyển đổi mã TS thuần (Code Transform)
      if (step.type === EPipelineStepType.CODE_TRANSFORM && step.transform) {
        try {
          currentInput = await step.transform(
            currentInput,
            (context.metadata as Record<string, unknown>) ?? {},
          );
          executedSteps.push({
            agent: step.id,
            task: step.name,
            persona: {
              role: step.name,
              goal: 'Chuyển đổi dữ liệu bằng mã logic lập trình',
            },
            toolCalls: [],
            result: currentInput,
          });

          currentStepIndex = this.resolveNextStepIndex(
            pipeline,
            step,
            currentInput,
            context,
            currentStepIndex,
          );
          continue;
        } catch (transformError) {
          this.logger.error(
            `[Pipeline: ${pipeline.id}] Lỗi thực thi code_transform tại step "${step.id}": ${(transformError as Error)?.message}`,
          );
          if (step.failurePolicy === EPipelineStepFailurePolicy.SKIP_AND_CONTINUE) {
            this.logger.warn(
              `[Pipeline: ${pipeline.id}] Bỏ qua lỗi tại step "${step.id}" do failurePolicy=SKIP_AND_CONTINUE`,
            );
            currentStepIndex++;
            continue;
          }
          throw transformError;
        }
      }

      // 4. Chuẩn bị prompt với bảo vệ Token Budget và chống Regex Injection
      let safeInput = currentInput;
      if (safeInput.length > 50000) {
        this.logger.warn(
          `[Pipeline: ${pipeline.id}] Input step "${step.id}" quá lớn (${safeInput.length} chars), tự động cắt bớt về 50k chars để tránh tràn token budget.`,
        );
        safeInput =
          safeInput.slice(0, 50000) + '\n...[Đã cắt bớt do quá độ dài an toàn]';
      }

      const stepPrompt = step.promptTemplate
        ? step.promptTemplate.replaceAll('{{input}}', () => safeInput)
        : safeInput;

      const stepMessageId = `${replyMessageId}:step:${step.id}`;

      const requestDto: RunReactLoopRequestDto = {
        prompt: stepPrompt,
        provider: step.provider ?? primaryProvider,
        providers: step.provider ? [step.provider] : connectedProviders,
        ...buildReactRequestIdentity(data),
        messageId: stepMessageId,
        history: [], // Cô lập theo từng step: output step trước được truyền thẳng qua prompt
        model:
          step.model ??
          process.env.DEFAULT_REACT_MODEL ??
          ORCHESTRATION_CONSTANTS.DEFAULT_REACT_MODEL,
        persona: {
          role: step.name,
          goal: step.systemPrompt ?? `Thực thi bước ${step.name}`,
        },
        allowedTools: step.tools ? [...step.tools] : undefined,
        skills: step.skills ? [...step.skills] : undefined,
        maxSelfCorrectionRetries: 2,
      };

      try {
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

            // 5. Kiểm tra tính hợp lệ bằng Output Schema và 1-shot self-healing correction
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
              runErr instanceof ApprovalRequiredError
            ) {
              throw runErr;
            }
            if (executionAttempt <= maxRetries) {
              this.logger.warn(
                `[Pipeline: ${pipeline.id}] Step "${step.id}" thất bại lần ${executionAttempt}/${maxRetries + 1}, thử lại...`,
              );
              continue;
            }
            throw runErr;
          }
        }

        currentInput = stepOutput;
        if (stepToolCalls.length > 0) {
          allToolCalls.push(...stepToolCalls);
        }

        executedSteps.push({
          agent: step.id,
          task: step.name,
          persona: { role: step.name, goal: step.systemPrompt ?? step.name },
          toolCalls: stepToolCalls,
          result: stepOutput,
        });

        // 6. Rẽ nhánh điều kiện (Conditional Branching)
        currentStepIndex = this.resolveNextStepIndex(
          pipeline,
          step,
          currentInput,
          context,
          currentStepIndex,
        );
      } catch (error) {
        if (error instanceof TurnCancelledError) {
          throw error;
        }

        if (error instanceof ApprovalRequiredError) {
          this.logger.warn(
            `[Pipeline: ${pipeline.id}] Step "${step.id}" gặp tool "${error.pendingTool.name}" yêu cầu phê duyệt`,
          );
          this.metrics.incrementBehaviorSignal('approval_required');

          const approvalNeeded: ApprovalRequiredDelegateResult = {
            approvalRequired: error.pendingTool,
            task: `Thao tác công cụ trong bước "${step.name}"`,
            toolCalls: error.toolCalls,
          };

          const accumulatedToolCalls = [
            ...allToolCalls,
            ...(error.toolCalls ?? []),
          ];

          const completedSteps = executedSteps.map((s) => ({
            agent: s.agent,
            task: s.task,
            result: s.result ?? '',
          }));

          const remainingSteps = pipeline.steps
            .slice(currentStepIndex + 1)
            .map((s) => ({
              agent: s.provider ?? s.id,
              task: s.name,
            }));

          return this.checkpointPause.pauseForApproval(
            data,
            prompt,
            completedSteps,
            accumulatedToolCalls,
            history,
            approvalNeeded,
            remainingSteps,
            EExecutionEngineMode.PIPELINE_CHAINING,
          );
        }

        this.logger.error(
          `[Pipeline: ${pipeline.id}] Lỗi khi thực thi step "${step.id}": ${(error as Error)?.message}`,
        );

        if (step.failurePolicy === EPipelineStepFailurePolicy.SKIP_AND_CONTINUE) {
          this.logger.warn(
            `[Pipeline: ${pipeline.id}] Bỏ qua lỗi tại step "${step.id}" do failurePolicy=SKIP_AND_CONTINUE`,
          );
          currentStepIndex++;
          continue;
        }

        throw error;
      }
    }

    this.logger.log(
      `Hoàn tất thành công toàn bộ pipeline "${pipeline.id}" cho turn ${replyMessageId}`,
    );

    return buildAnswer(currentInput, allToolCalls, executedSteps);
  }

  /**
   * Đánh giá điều kiện rẽ nhánh và trả về index của step tiếp theo
   */
  private resolveNextStepIndex(
    pipeline: PipelineDefinition,
    step: PipelineStepDefinition,
    output: string,
    context: EngineExecutionContext,
    currentIndex: number,
  ): number {
    if (step.condition) {
      try {
        const decision = step.condition(
          output,
          (context.metadata as Record<string, unknown>) ?? {},
        );

        let targetStepId: string | undefined;
        if (typeof decision === 'string') {
          targetStepId = step.branchMap?.[decision] ?? decision;
        } else if (decision === true && step.defaultNextStepId) {
          targetStepId = step.defaultNextStepId;
        }

        if (targetStepId) {
          const targetIndex = pipeline.steps.findIndex(
            (s) => s.id === targetStepId,
          );
          if (targetIndex >= 0) {
            this.logger.log(
              `[Pipeline: ${pipeline.id}] Rẽ nhánh thành công từ step "${step.id}" sang step "${targetStepId}" (index ${targetIndex})`,
            );
            return targetIndex;
          }
          this.logger.warn(
            `[Pipeline: ${pipeline.id}] Không tìm thấy step đích "${targetStepId}" trong pipeline, tiếp tục step kế tiếp.`,
          );
        }
      } catch (condError) {
        this.logger.warn(
          `[Pipeline: ${pipeline.id}] Lỗi khi đánh giá condition tại step "${step.id}": ${(condError as Error)?.message}`,
        );
      }
    }

    if (step.defaultNextStepId) {
      const targetIndex = pipeline.steps.findIndex(
        (s) => s.id === step.defaultNextStepId,
      );
      if (targetIndex >= 0) return targetIndex;
    }

    return currentIndex + 1;
  }

  /**
   * Xác thực định dạng output với Zod Schema và kích hoạt 1-shot self-healing correction nếu format sai
   */
  private async validateAndSelfHealSchema(
    step: PipelineStepDefinition,
    output: string,
    baseRequestDto: RunReactLoopRequestDto,
    signal?: AbortSignal,
  ): Promise<string> {
    if (!step.outputSchema) return output;

    const parsedPayload = this.parseOrRepairJson(output);

    // Nếu outputSchema là Zod schema
    if (isZodSchema(step.outputSchema)) {
      const parseResult = step.outputSchema.safeParse(parsedPayload);
      if (parseResult.success) {
        return typeof parsedPayload === 'string'
          ? parsedPayload
          : JSON.stringify(parsedPayload, null, 2);
      }

      this.logger.warn(
        `[Pipeline Step: ${step.id}] Output không khớp schema: ${JSON.stringify(parseResult.error.format())}. Kích hoạt 1-shot self-healing...`,
      );

      // Kích hoạt 1-shot correction prompt
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
            `[Pipeline Step: ${step.id}] 1-shot self-healing thành công! Output đã hợp lệ.`,
          );
          return JSON.stringify(healedPayload, null, 2);
        }
      } catch (healError) {
        this.logger.warn(
          `[Pipeline Step: ${step.id}] 1-shot self-healing thất bại: ${(healError as Error)?.message}`,
        );
      }
    }

    return output;
  }

  /**
   * Trích xuất và sửa lỗi cú pháp JSON từ phản hồi LLM sử dụng agentic-io-parser
   */
  private parseOrRepairJson(rawText: string): unknown {
    try {
      return JSON.parse(rawText);
    } catch {
      // 1. Thử dùng JsonRepair sửa cú pháp (thiếu quotes, trailing commas...)
      try {
        return this.jsonRepair.repairAndParse(rawText);
      } catch {
        // 2. Thử bóc tách markdown block bằng JsonExtractor rồi sửa
        try {
          const extracted = this.jsonExtractor.extract(rawText);
          return this.jsonRepair.repairAndParse(extracted);
        } catch {
          return null;
        }
      }
    }
  }

  private resolvePipeline(context: EngineExecutionContext): PipelineDefinition {
    if (context.metadata?.pipeline) {
      return context.metadata.pipeline as PipelineDefinition;
    }

    const workflowId = context.data.workflowId;
    if (workflowId && this.pipelines.has(workflowId)) {
      return this.pipelines.get(workflowId)!;
    }

    return this.pipelines.get(DEFAULT_TWO_STEP_PIPELINE_ID)!;
  }

  private registerBuiltInPipelines(): void {
    this.registerPipeline({
      id: DEFAULT_TWO_STEP_PIPELINE_ID,
      name: 'Default Chaining Pipeline',
      description: DEFAULT_PIPELINE_DESCRIPTION,
      steps: [
        {
          id: 'step_extract',
          name: 'Trích xuất Dữ liệu Thô',
          model:
            process.env.CHEAP_TIER_MODEL ??
            process.env.DEFAULT_REACT_MODEL ??
            ORCHESTRATION_CONSTANTS.DEFAULT_REACT_MODEL,
          systemPrompt: EXTRACT_STEP_SYSTEM_PROMPT,
          promptTemplate: EXTRACT_STEP_PROMPT_TEMPLATE,
        },
        {
          id: 'step_synthesize',
          name: 'Tổng hợp Chiến lược & Khuyến nghị',
          model:
            process.env.PREMIUM_TIER_MODEL ??
            process.env.DEFAULT_REACT_MODEL ??
            ORCHESTRATION_CONSTANTS.DEFAULT_REACT_MODEL,
          systemPrompt: SYNTHESIZE_STEP_SYSTEM_PROMPT,
          promptTemplate: SYNTHESIZE_STEP_PROMPT_TEMPLATE,
        },
      ],
    });
  }
  async resume(checkpoint: CheckpointResponseDto): Promise<AnswerResult> {
    const { userId, replyMessageId, workspaceId, channelId, sessionType, channelType } = checkpoint;
    const conversationId = checkpoint.conversationId ?? channelId;

    const pipeline = this.resolvePipelineFromCheckpoint(checkpoint);
    if (!pipeline) {
      throw new Error(
        `[PipelineChainingEngine] Không tìm thấy pipeline cho turn ${replyMessageId}`,
      );
    }

    if (!this.toolProvider) {
      throw new Error(
        '[PipelineChainingEngine] Thiếu toolProvider để thực thi tool đã duyệt',
      );
    }

    const pendingTool = checkpoint.pendingTool;
    if (!pendingTool) {
      throw new Error(
        `[PipelineChainingEngine] Checkpoint ${checkpoint.id} thiếu pendingTool`,
      );
    }

    this.logger.log(
      `[PipelineChainingEngine] Resume step cho turn ${replyMessageId}: thực thi tool ${pendingTool.provider}.${pendingTool.name}`,
    );

    const toolResult = await this.toolProvider.callTool({
      provider: pendingTool.provider,
      name: pendingTool.name,
      args: pendingTool.args,
      ownerId: userId,
      workspaceId,
    });

    const toolResultText = extractTextFromMcpResult(toolResult);
    if (toolResult.isError) {
      return buildAnswer(
        buildApprovedToolFailureMessage(pendingTool.name, toolResultText),
        [],
      );
    }

    const executedSteps: ExecutedStepDto[] = (checkpoint.roundsSoFar ?? []).map((r) => ({
      agent: r.agent,
      task: r.task,
      result: r.result,
      toolCalls: [],
    }));

    const currentStepIndex = checkpoint.roundsSoFar.length;
    const currentStep = pipeline.steps[currentStepIndex];

    const currentStepToolCalls: ToolCallTraceDto[] = [
      {
        tool: `${pendingTool.provider}:${pendingTool.name}`,
        status: EStepExecutionStatus.SUCCESS,
        resultPreview: toolResultText.slice(0, 200),
        argsPreview: JSON.stringify(pendingTool.args).slice(0, 200),
      },
    ];

    if (currentStep) {
      executedSteps.push({
        agent: currentStep.id,
        task: currentStep.name,
        persona: {
          role: currentStep.name,
          goal: currentStep.systemPrompt ?? currentStep.name,
        },
        toolCalls: currentStepToolCalls,
        result: toolResultText,
      });
    }

    const context: EngineExecutionContext = {
      data: {
        userId,
        channelId: conversationId,
        conversationId,
        messageId: replyMessageId,
        workspaceId,
        tenantId: workspaceId,
        sessionType,
        channelType,
      },
      replyMessageId,
      prompt: checkpoint.originalPrompt,
      agents: [],
      history: checkpoint.history,
    };

    return this.executePipeline(
      pipeline,
      context,
      currentStepIndex + 1,
      toolResultText,
      executedSteps,
      currentStepToolCalls,
    );
  }

  private resolvePipelineFromCheckpoint(
    checkpoint: CheckpointResponseDto,
  ): PipelineDefinition | undefined {
    for (const [id, pipeline] of this.pipelines.entries()) {
      if (
        checkpoint.originalPrompt.includes(id) ||
        checkpoint.pendingTask.includes(id) ||
        checkpoint.pendingTask.includes(pipeline.name)
      ) {
        return pipeline;
      }
    }
    return (
      this.pipelines.get(DEFAULT_TWO_STEP_PIPELINE_ID) ??
      Array.from(this.pipelines.values())[0]
    );
  }
}
