import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import {
  ORCHESTRATION_CONSTANTS,
  ECheckpointKind,
  EStepExecutionStatus,
} from '@agent/core/constants';
import {
  IExecutionEngine,
  EngineRoutingContext,
  EngineExecutionContext,
  EExecutionEngineMode,
} from '../../../contracts/engine/execution-engine.interface';
import {
  AnswerResult,
  ApprovalRequiredDelegateResult,
  buildAnswer,
} from '../../../contracts/engine/orchestration-answer.types';
import { ReactLoopService } from '../../loop/react-loop.service';
import { AgentCancellationService } from '../../cancellation/agent-cancellation.service';
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
import { ClarificationRequiredError } from '../../../contracts/engine/clarification-required.error';
import { AvailableAgentDto } from '../../../contracts/dtos/supervisor.dto';
import { SupervisorService } from '../../supervisor/supervisor.service';
import {
  IToolProvider,
  TOOL_PROVIDER,
} from '../../../contracts/tools/tool-provider.interface';
import { CheckpointResponseDto } from '../../../contracts/dtos/checkpoint.dto';
import { extractTextFromMcpResult } from '../../../common/mcp.util';

/**
 * SingleAgentEngine
 *
 * Engine thực thi Multi-Provider Single Agent (Nhánh 1 trong Master Blueprint: chiếm 80-85% tác vụ).
 * Tải trực tiếp công cụ từ tất cả providers kết nối trong 1 context duy nhất, phản hồi nhanh < 2s,
 * tiết kiệm token và bảo toàn 100% ngữ cảnh đàm thoại.
 *
 * Hardened Features:
 * - Self-Correction Reflection Loop: Giới hạn cứng tối đa 2 lần retry khi tool error, tránh loop vô tận.
 * - Clarification HITL: Tạm dừng hỏi làm rõ khi yêu cầu mơ hồ hoặc có nhiều lựa chọn tương đương.
 * - Polymorphic Resume: Tự phục hồi ReAct loop khi người dùng phê duyệt hoặc làm rõ thông tin.
 */
@Injectable()
export class SingleAgentEngine implements IExecutionEngine {
  readonly id = EExecutionEngineMode.SINGLE_AGENT;
  readonly name = 'Multi-Provider Single Agent';
  readonly priority = 10;

  private readonly logger = new Logger(SingleAgentEngine.name);

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
    @Inject(TOOL_PROVIDER)
    private readonly toolProvider?: IToolProvider,
  ) {}

  canHandle(context: EngineRoutingContext): boolean {
    if (context.forcedMode === 'single') return true;
    if (context.forcedMode && context.forcedMode !== 'auto') return false;
    // Mặc định Single Agent tiếp nhận nếu có agents hoặc không yêu cầu đặc thù
    return true;
  }

  async execute(context: EngineExecutionContext): Promise<AnswerResult> {
    const { data, replyMessageId, prompt, agents, history, signal } = context;
    const connectedProviders = (agents ?? []).map((a) => a.provider);
    const primaryProvider = connectedProviders[0] ?? 'compute';

    this.logger.log(
      `Thực thi Multi-Provider Single Agent cho turn ${replyMessageId} (providers: ${connectedProviders.join(', ')})`,
    );

    const isCancelled = await this.cancellation.isCancelled(replyMessageId);
    if (signal?.aborted || isCancelled) {
      throw new TurnCancelledError(undefined);
    }

    const requestDto: RunReactLoopRequestDto = {
      prompt,
      provider: primaryProvider,
      providers: connectedProviders,
      userId: data.userId,
      channelId: data.conversationId ?? data.channelId,
      conversationId: data.conversationId,
      workspaceId: data.tenantId ?? data.workspaceId,
      tenantId: data.tenantId,
      messageId: replyMessageId,
      channelType: data.sessionType ?? data.channelType ?? 'web',
      sessionType: data.sessionType,
      history,
      model:
        process.env.DEFAULT_REACT_MODEL ??
        ORCHESTRATION_CONSTANTS.DEFAULT_REACT_MODEL,
      maxSelfCorrectionRetries: 2,
    };

    try {
      const result = await this.reactLoop.run(requestDto, signal);

      if (result.clarificationRequired) {
        this.logger.warn(
          `Single Agent phát hiện yêu cầu làm rõ: "${result.clarificationRequired.question}"`,
        );
        this.metrics.incrementBehaviorSignal('clarification_required');
        const candidates: AvailableAgentDto[] =
          result.clarificationRequired.candidates.map((c) => ({
            provider: c.id,
            label: c.label,
            description: c.description ?? '',
          }));

        const paused = await this.checkpointPause.pauseForClarification(
          data,
          prompt,
          [],
          result.toolCalls,
          history,
          result.clarificationRequired.question,
          candidates,
          [],
          EExecutionEngineMode.SINGLE_AGENT,
        );
        return this.withSingleAgentStep(
          paused,
          prompt,
          connectedProviders,
          result.toolCalls,
        );
      }

      this.logger.log(
        `Hoàn tất Multi-Provider Single Agent cho messageId=${replyMessageId}`,
      );

      const priorToolCalls =
        (context.metadata?.priorToolCalls as ToolCallTraceDto[]) ?? [];
      const allToolCalls = [...priorToolCalls, ...result.toolCalls];

      return buildAnswer(result.answer, allToolCalls, [
        this.buildSingleAgentStep(prompt, connectedProviders, allToolCalls, result.answer),
      ]);
    } catch (error) {
      if (error instanceof TurnCancelledError) {
        throw error;
      }

      const priorToolCalls =
        (context.metadata?.priorToolCalls as ToolCallTraceDto[]) ?? [];

      if (error instanceof ClarificationRequiredError) {
        this.logger.warn(
          `Single Agent tạm dừng chờ Clarification HITL: "${error.question}"`,
        );
        this.metrics.incrementBehaviorSignal('clarification_required');
        const candidates: AvailableAgentDto[] = error.candidates.map((c) => ({
          provider: c.id,
          label: c.label,
          description: c.description ?? '',
        }));

        const toolCalls = [
          ...priorToolCalls,
          ...(error.toolCalls ?? []),
        ];

        const paused = await this.checkpointPause.pauseForClarification(
          data,
          prompt,
          [],
          toolCalls,
          history,
          error.question,
          candidates,
          [],
          EExecutionEngineMode.SINGLE_AGENT,
        );
        return this.withSingleAgentStep(
          paused,
          prompt,
          connectedProviders,
          toolCalls,
        );
      }

      if (error instanceof ApprovalRequiredError) {
        this.logger.warn(
          `Single Agent tạm dừng chờ HITL approval cho tool "${error.pendingTool.name}" (provider=${error.pendingTool.provider})`,
        );
        this.metrics.incrementBehaviorSignal('approval_required');

        const toolCalls = [
          ...priorToolCalls,
          ...(error.toolCalls ?? []),
        ];

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
          EExecutionEngineMode.SINGLE_AGENT,
        );
        return this.withSingleAgentStep(
          paused,
          prompt,
          connectedProviders,
          toolCalls,
        );
      }

      this.logger.error(
        `Lỗi khi thực thi Single Agent cho turn ${replyMessageId}: ${(error as Error)?.message}`,
        (error as Error)?.stack,
      );
      throw error;
    }
  }

  // Turn dừng giữa chừng (HITL) vẫn phải lưu step + persona của Single Agent để
  // reload trang dựng lại đúng card agent kèm các tool đã chạy.
  private withSingleAgentStep(
    paused: AnswerResult,
    prompt: string,
    connectedProviders: string[],
    toolCalls: ToolCallTraceDto[],
  ): AnswerResult {
    return buildAnswer(paused.content, toolCalls, [
      this.buildSingleAgentStep(prompt, connectedProviders, toolCalls),
    ]);
  }

  private buildSingleAgentStep(
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
        goal: `Thực thi trực tiếp đa công cụ (${connectedProviders.join(', ')})`,
      },
      toolCalls,
      ...(result !== undefined ? { result } : {}),
    };
  }

  async resume(checkpoint: CheckpointResponseDto): Promise<AnswerResult> {
    const userId = checkpoint.userId;
    const replyMessageId = checkpoint.replyMessageId;
    const conversationId = checkpoint.conversationId ?? checkpoint.channelId;
    const workspaceId = checkpoint.workspaceId;

    const agents = this.supervisor
      ? await this.supervisor.getAvailableAgents(userId, workspaceId)
      : [];

    if (checkpoint.kind === ECheckpointKind.CLARIFICATION) {
      const candidateId =
        checkpoint.selectedCandidateId || checkpoint.selectedProvider;
      const candidate = checkpoint.clarificationCandidates?.find(
        (c) =>
          c.provider === candidateId ||
          (c as unknown as { id?: string }).id === candidateId,
      );
      const candidateLabel = candidate?.label ?? candidateId ?? 'Đã xác nhận';
      const clarifiedPrompt = `${checkpoint.originalPrompt}\n\n[Khách hàng được chọn: ${candidateLabel} (Mã: ${candidateId})]`;

      this.logger.log(
        `[SingleAgentEngine] Resume Clarification cho turn ${replyMessageId}: ${candidateLabel} (${candidateId})`,
      );

      const priorToolCalls = checkpoint.toolCalls ?? [];

      const context: EngineExecutionContext = {
        data: {
          userId,
          channelId: conversationId,
          conversationId,
          messageId: replyMessageId,
          workspaceId,
          tenantId: workspaceId,
          sessionType: checkpoint.sessionType,
          channelType: checkpoint.channelType,
        },
        replyMessageId,
        prompt: clarifiedPrompt,
        agents,
        history: checkpoint.history,
        metadata: {
          priorToolCalls,
        },
      };

      return this.execute(context);
    }

    if (checkpoint.kind === ECheckpointKind.APPROVAL) {
      const pendingTool = checkpoint.pendingTool;
      if (!pendingTool) {
        throw new Error('Checkpoint approval thiếu thông tin pendingTool');
      }

      this.logger.log(
        `[SingleAgentEngine] Resume Approval cho turn ${replyMessageId}: thực thi tool ${pendingTool.provider}.${pendingTool.name}`,
      );

      if (!this.toolProvider) {
        throw new Error(
          'SingleAgentEngine thiếu toolProvider để thực thi tool đã duyệt',
        );
      }

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
          `⚠️ Hành động "${pendingTool.name}" đã được duyệt nhưng thực thi thất bại:\n${toolResultText}`,
          [],
        );
      }

      const executedPendingTool: ToolCallTraceDto = {
        tool: `${pendingTool.provider}.${pendingTool.name}`,
        status: EStepExecutionStatus.SUCCESS,
        argsPreview: JSON.stringify(pendingTool.args).slice(0, 500),
        resultPreview: toolResultText.slice(0, 500),
      };

      const priorToolCalls: ToolCallTraceDto[] = [
        ...(checkpoint.toolCalls ?? []),
        executedPendingTool,
      ];

      const followUpPrompt = `[BỐI CẢNH TIẾN ĐỘ THỰC THI]:
- Yêu cầu gốc: "${checkpoint.originalPrompt}"
- Hành động rủi ro "${pendingTool.provider}.${pendingTool.name}" ĐÃ ĐƯỢC NGƯỜI DÙNG PHÊ DUYỆT VÀ ĐÃ THỰC THI THÀNH CÔNG trên hệ thống.
- Kết quả thực thi thực tế: ${toolResultText.slice(0, 1500)}

[CHỈ DẪN TIẾP TỤC]:
1. TUYỆT ĐỐI KHÔNG gọi lại hành động "${pendingTool.name}" hoặc các bước đã hoàn tất trước đó (dữ liệu đã được ghi nhận trên hệ thống).
2. Nếu trong yêu cầu ban đầu CÒN BƯỚC TIẾP THEO (ví dụ: gửi thông báo Slack/Email, tổng hợp thêm...), hãy tiếp tục sử dụng công cụ phù hợp để hoàn tất.
3. Nếu TẤT CẢ CÁC BƯỚC ĐÃ XONG, hãy viết câu trả lời hoàn chỉnh để báo cáo kết quả cho người dùng.`;
      const context: EngineExecutionContext = {
        data: {
          userId,
          channelId: conversationId,
          conversationId,
          messageId: replyMessageId,
          workspaceId,
          tenantId: workspaceId,
          sessionType: checkpoint.sessionType,
          channelType: checkpoint.channelType,
        },
        replyMessageId,
        prompt: followUpPrompt,
        agents,
        history: checkpoint.history,
        metadata: {
          priorToolCalls,
        },
      };

      return this.execute(context);
    }

    throw new Error(
      `SingleAgentEngine không hỗ trợ checkpoint kind=${checkpoint.kind}`,
    );
  }
}
