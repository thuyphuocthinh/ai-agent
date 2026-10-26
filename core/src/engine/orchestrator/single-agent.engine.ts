import { Injectable, Logger, Optional } from '@nestjs/common';
import { ORCHESTRATION_CONSTANTS } from '@agent/core/constants';
import {
  IExecutionEngine,
  EngineRoutingContext,
  EngineExecutionContext,
  EExecutionEngineMode,
} from '../../contracts/execution-engine.interface';
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
import { RunReactLoopRequestDto } from '../../contracts/dtos/react-loop.dto';
import { ExecutedStepDto } from '../../contracts/dtos/message-client.dto';
import { SubAgentSpawnerService } from './sub-agent-spawner.service';

/**
 * SingleAgentEngine
 *
 * Engine thực thi Multi-Provider Single Agent (Nhánh 1 trong Master Blueprint: chiếm 80-85% tác vụ).
 * Tải trực tiếp công cụ từ tất cả providers kết nối trong 1 context duy nhất, phản hồi nhanh < 2s,
 * tiết kiệm token và bảo toàn 100% ngữ cảnh đàm thoại.
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
    };

    try {
      const result = await this.reactLoop.run(requestDto, signal);
      this.logger.log(
        `Hoàn tất Multi-Provider Single Agent cho messageId=${replyMessageId}`,
      );

      const singleAgentStep: ExecutedStepDto = {
        agent: 'single_agent',
        task: prompt,
        persona: {
          role: 'Multi-Provider Single Agent',
          goal: `Thực thi trực tiếp đa công cụ (${connectedProviders.join(', ')})`,
        },
        toolCalls: result.toolCalls,
        result: result.answer,
      };

      return buildAnswer(result.answer, result.toolCalls, [singleAgentStep]);
    } catch (error) {
      if (error instanceof TurnCancelledError) {
        throw error;
      }

      if (error instanceof ApprovalRequiredError) {
        this.logger.warn(
          `Single Agent tạm dừng chờ HITL approval cho tool "${error.pendingTool.name}" (provider=${error.pendingTool.provider})`,
        );
        this.metrics.incrementBehaviorSignal('approval_required');

        const approvalNeeded: ApprovalRequiredDelegateResult = {
          approvalRequired: error.pendingTool,
          task: prompt,
          toolCalls: error.toolCalls,
        };

        return this.checkpointPause.pauseForApproval(
          data,
          prompt,
          [
            {
              agent: error.pendingTool.provider,
              task: prompt,
              result: `Đang chờ người dùng phê duyệt thao tác ${error.pendingTool.name}`,
            },
          ],
          error.toolCalls,
          history,
          approvalNeeded,
          [],
        );
      }

      this.logger.error(
        `Lỗi khi thực thi Single Agent cho turn ${replyMessageId}: ${(error as Error)?.message}`,
        (error as Error)?.stack,
      );
      throw error;
    }
  }
}
