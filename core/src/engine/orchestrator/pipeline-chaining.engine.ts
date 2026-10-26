import { Injectable, Logger } from '@nestjs/common';
import { ORCHESTRATION_CONSTANTS } from '@agent/core/constants';
import {
  EngineRoutingContext,
  EngineExecutionContext,
  EExecutionEngineMode,
} from '../../contracts/execution-engine.interface';
import {
  IPipelineChainingEngine,
  PipelineDefinition,
  PipelineStepDefinition,
  EPipelineStepType,
} from '../../contracts/pipeline-chaining.interface';
import {
  AnswerResult,
  ApprovalRequiredDelegateResult,
  buildAnswer,
} from './orchestration-answer.types';
import { ReactLoopService } from '../loop/react-loop.service';
import { AgentCancellationService } from '../cancellation/agent-cancellation.service';
import { CheckpointPauseService } from '../hitl/checkpoint-pause.service';
import { MetricsRegistryService } from '../../common/metrics-registry.service';
import { TurnCancelledError } from '../loop/turn-cancelled.error';
import { ApprovalRequiredError } from '../loop/approval-required.error';
import {
  RunReactLoopRequestDto,
  ToolCallTraceDto,
} from '../../contracts/dtos/react-loop.dto';
import { ExecutedStepDto } from '../../contracts/dtos/message-client.dto';
import { PendingToolCall } from '../../infrastructure/database/entities/orchestration-checkpoint.entity';

const PIPELINE_INTENT_REGEX =
  /(quy trình|pipeline|báo cáo tuần|onboarding|theo các bước tuần tự|bước 1.*bước 2|chaining)/i;

/**
 * PipelineChainingEngine
 *
 * Engine thực thi Pipeline Chaining tuần tự (Nhánh 2 trong Master Blueprint: chiếm 10% tác vụ).
 * Hỗ trợ Model Tiering (Step 1 dùng Model rẻ bóc tách dữ liệu -> Step sau dùng Model xịn tổng hợp),
 * Output của Step trước tự động làm Input của Step sau, luồng mã nguồn deterministic và tin cậy 100%.
 */
@Injectable()
export class PipelineChainingEngine implements IPipelineChainingEngine {
  readonly id = EExecutionEngineMode.PIPELINE_CHAINING;
  readonly name = 'Pipeline Chaining Engine (Sequential DAG)';
  readonly priority = 20;

  private readonly logger = new Logger(PipelineChainingEngine.name);
  private readonly pipelines = new Map<string, PipelineDefinition>();

  constructor(
    private readonly reactLoop: ReactLoopService,
    private readonly cancellation: AgentCancellationService,
    private readonly checkpointPause: CheckpointPauseService,
    private readonly metrics: MetricsRegistryService,
  ) {
    this.registerBuiltInPipelines();
  }

  registerPipeline(pipeline: PipelineDefinition): void {
    if (!pipeline?.id) {
      throw new Error('[PipelineChainingEngine] Pipeline id là bắt buộc');
    }
    this.pipelines.set(pipeline.id, pipeline);
    this.logger.log(`Đã đăng ký pipeline "${pipeline.id}" (${pipeline.name}) [${pipeline.steps.length} steps]`);
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
  ): Promise<AnswerResult> {
    const { data, replyMessageId, prompt, agents, history, signal } = context;
    const connectedProviders = (agents ?? []).map((a) => a.provider);
    const primaryProvider = connectedProviders[0] ?? 'compute';

    this.logger.log(
      `Bắt đầu thực thi pipeline "${pipeline.id}" (${pipeline.name}) cho turn ${replyMessageId} [${pipeline.steps.length} steps]`,
    );

    let currentInput = prompt;
    const allToolCalls: ToolCallTraceDto[] = [];
    const executedSteps: ExecutedStepDto[] = [];

    for (let i = 0; i < pipeline.steps.length; i++) {
      const step = pipeline.steps[i];

      // 1. Kiểm tra cờ hủy
      const isCancelled = await this.cancellation.isCancelled(replyMessageId);
      if (signal?.aborted || isCancelled) {
        throw new TurnCancelledError(undefined);
      }

      this.logger.log(
        `[Pipeline: ${pipeline.id}] Đang thực thi Step ${i + 1}/${pipeline.steps.length}: "${step.name}" (model=${step.model ?? 'default'})`,
      );

      // 2. Kiểm tra Human-In-The-Loop Gate ở cấp độ Step
      if (step.requireHumanApproval) {
        this.logger.warn(
          `[Pipeline: ${pipeline.id}] Step "${step.id}" yêu cầu phê duyệt con người trước khi tiếp tục.`,
        );
        this.metrics.incrementBehaviorSignal('approval_required');

        const pendingTool: PendingToolCall = {
          name: `step_gate:${step.id}`,
          provider: step.provider ?? primaryProvider,
          args: { stepId: step.id, stepName: step.name, inputPreview: currentInput.slice(0, 300) },
        };

        const approvalNeeded: ApprovalRequiredDelegateResult = {
          approvalRequired: pendingTool,
          task: `Yêu cầu phê duyệt thực thi bước "${step.name}" trong quy trình ${pipeline.name}`,
          toolCalls: allToolCalls,
        };

        return this.checkpointPause.pauseForApproval(
          data,
          prompt,
          executedSteps.map((s) => ({
            agent: s.agent,
            task: s.task,
            result: s.result ?? '',
          })),
          allToolCalls,
          history,
          approvalNeeded,
          [],
        );
      }

      // 3. Xử lý Step chuyển đổi mã TS thuần (Code Transform)
      if (step.type === EPipelineStepType.CODE_TRANSFORM && step.transform) {
        try {
          currentInput = await step.transform(currentInput, (context.metadata as Record<string, unknown>) ?? {});
          executedSteps.push({
            agent: step.id,
            task: step.name,
            persona: { role: step.name, goal: 'Chuyển đổi dữ liệu bằng mã logic lập trình' },
            toolCalls: [],
            result: currentInput,
          });
          continue;
        } catch (transformError) {
          this.logger.error(
            `[Pipeline: ${pipeline.id}] Lỗi thực thi code_transform tại step "${step.id}": ${(transformError as Error)?.message}`,
          );
          throw transformError;
        }
      }

      // 4. Chuẩn bị prompt và cấu hình ReAct Loop cho Step
      // 4. Chuẩn bị prompt với bảo vệ Token Budget và chống Regex Injection
      let safeInput = currentInput;
      if (safeInput.length > 50000) {
        this.logger.warn(
          `[Pipeline: ${pipeline.id}] Input step "${step.id}" quá lớn (${safeInput.length} chars), tự động cắt bớt về 50k chars để tránh tràn token budget.`,
        );
        safeInput = safeInput.slice(0, 50000) + '\n...[Đã cắt bớt do quá độ dài an toàn]';
      }

      const stepPrompt = step.promptTemplate
        ? step.promptTemplate.replaceAll('{{input}}', () => safeInput)
        : safeInput;

      const stepMessageId = `${replyMessageId}:step:${step.id}`;

      const requestDto: RunReactLoopRequestDto = {
        prompt: stepPrompt,
        provider: step.provider ?? primaryProvider,
        providers: step.provider ? [step.provider] : connectedProviders,
        userId: data.userId,
        channelId: data.conversationId ?? data.channelId,
        conversationId: data.conversationId,
        workspaceId: data.tenantId ?? data.workspaceId,
        tenantId: data.tenantId,
        messageId: stepMessageId,
        channelType: data.sessionType ?? data.channelType ?? 'web',
        sessionType: data.sessionType,
        history: [], // Cô lập theo từng step: output step trước được truyền thẳng qua prompt
        model: step.model ?? process.env.DEFAULT_REACT_MODEL ?? ORCHESTRATION_CONSTANTS.DEFAULT_REACT_MODEL,
        persona: {
          role: step.name,
          goal: step.systemPrompt ?? `Thực thi bước ${step.name}`,
        },
        allowedTools: step.tools ? [...step.tools] : undefined,
      };

      try {
        const result = await this.reactLoop.run(requestDto, signal);

        currentInput = result.answer;
        if (result.toolCalls && result.toolCalls.length > 0) {
          allToolCalls.push(...result.toolCalls);
        }

        executedSteps.push({
          agent: step.id,
          task: step.name,
          persona: { role: step.name, goal: step.systemPrompt ?? step.name },
          toolCalls: result.toolCalls,
          result: result.answer,
        });
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

          return this.checkpointPause.pauseForApproval(
            data,
            prompt,
            executedSteps.map((s) => ({
              agent: s.agent,
              task: s.task,
              result: s.result ?? '',
            })),
            [...allToolCalls, ...(error.toolCalls ?? [])],
            history,
            approvalNeeded,
            [],
          );
        }

        this.logger.error(
          `[Pipeline: ${pipeline.id}] Lỗi khi thực thi step "${step.id}": ${(error as Error)?.message}`,
        );
        throw error;
      }
    }

    this.logger.log(
      `Hoàn tất thành công toàn bộ pipeline "${pipeline.id}" cho turn ${replyMessageId}`,
    );

    return buildAnswer(currentInput, allToolCalls, executedSteps);
  }

  private resolvePipeline(context: EngineExecutionContext): PipelineDefinition {
    if (context.metadata?.pipeline) {
      return context.metadata.pipeline as PipelineDefinition;
    }

    const workflowId = context.data.workflowId;
    if (workflowId && this.pipelines.has(workflowId)) {
      return this.pipelines.get(workflowId)!;
    }

    // Default built-in general pipeline: 2-step extraction -> strategic synthesis
    return this.pipelines.get('default-two-step-pipeline')!;
  }

  private registerBuiltInPipelines(): void {
    this.registerPipeline({
      id: 'default-two-step-pipeline',
      name: 'Default Chaining Pipeline',
      description: 'Quy trình chuẩn 2 bước: Bóc tách dữ liệu thô (Model rẻ) -> Phân tích & Tổng hợp (Model xịn)',
      steps: [
        {
          id: 'step_extract',
          name: 'Trích xuất Dữ liệu Thô',
          model: process.env.CHEAP_TIER_MODEL ?? process.env.DEFAULT_REACT_MODEL ?? ORCHESTRATION_CONSTANTS.DEFAULT_REACT_MODEL,
          systemPrompt: 'Bạn là chuyên viên trích xuất dữ liệu. Hãy bóc tách các ý chính, thông số số liệu và thông tin cấu trúc từ yêu cầu của người dùng một cách chính xác, ngắn gọn.',
          promptTemplate: 'Dữ liệu đầu vào từ người dùng:\n{{input}}\n\nHãy trích xuất đầy đủ các thông tin cốt lõi.',
        },
        {
          id: 'step_synthesize',
          name: 'Tổng hợp Chiến lược & Khuyến nghị',
          model: process.env.PREMIUM_TIER_MODEL ?? process.env.DEFAULT_REACT_MODEL ?? ORCHESTRATION_CONSTANTS.DEFAULT_REACT_MODEL,
          systemPrompt: 'Bạn là chuyên gia cố vấn cao cấp. Dựa trên dữ liệu đã được trích xuất, hãy đưa ra câu trả lời toàn diện, sâu sắc và các khuyến nghị tối ưu nhất.',
          promptTemplate: 'Dữ liệu đã được bóc tách từ bước trước:\n{{input}}\n\nHãy tổng hợp thành câu trả lời hoàn chỉnh, mạch lạc và chuyên nghiệp.',
        },
      ],
    });
  }
}
