import { Inject, Injectable, Logger } from '@nestjs/common';
import { IStreamSink, STREAM_SINK } from '../../contracts';
import { RunReactLoopRequestDto } from '../../contracts/dtos/react-loop.dto';
import { ReactLoopService } from '../loop/react-loop.service';
import { AgentCancellationService } from '../cancellation/agent-cancellation.service';
import { CheckpointPauseService } from '../hitl/checkpoint-pause.service';
import { MetricsRegistryService } from '../../infrastructure/resilience/metrics-registry.service';
import { TurnCancelledError } from '../loop/errors/turn-cancelled.error';
import { ApprovalRequiredError } from '../loop/errors/approval-required.error';
import {
  AnswerResult,
  ApprovalRequiredDelegateResult,
  buildAnswer,
} from '../../contracts/engine/orchestration-answer.types';
import { RunWorkflowOptions } from './workflow-runner.interface';

@Injectable()
export class WorkflowRunnerService {
  private readonly logger = new Logger(WorkflowRunnerService.name);

  constructor(
    private readonly reactLoop: ReactLoopService,
    @Inject(STREAM_SINK)
    private readonly streamSink: IStreamSink,
    private readonly cancellation: AgentCancellationService,
    private readonly checkpointPause: CheckpointPauseService,
    private readonly metrics: MetricsRegistryService,
  ) {}

  async runWorkflow(options: RunWorkflowOptions): Promise<AnswerResult> {
    const { workflow, prompt, data, replyMessageId, history, signal } = options;

    this.logger.log(
      `Bắt đầu thực thi fixed workflow "${workflow.id}" (${workflow.name}) cho user=${data.userId} messageId=${replyMessageId}`,
    );

    const isCancelled = await this.cancellation.isCancelled(replyMessageId);
    if (signal?.aborted || isCancelled) {
      throw new TurnCancelledError(undefined);
    }

    const requestDto: RunReactLoopRequestDto = {
      prompt,
      provider: workflow.provider ?? 'compute',
      userId: data.userId,
      channelId: data.conversationId ?? data.channelId,
      conversationId: data.conversationId,
      workspaceId: data.tenantId ?? data.workspaceId,
      tenantId: data.tenantId,
      messageId: replyMessageId,
      channelType: data.sessionType ?? data.channelType ?? 'web',
      sessionType: data.sessionType,
      history,
      model: workflow.model,
      persona: {
        role: workflow.name,
        goal: workflow.systemPrompt,
      },
      allowedTools: workflow.tools ? [...workflow.tools] : undefined,
    };

    try {
      const result = await this.reactLoop.run(requestDto, signal);
      this.logger.log(
        `Hoàn tất fixed workflow "${workflow.id}" cho messageId=${replyMessageId}`,
      );
      return buildAnswer(result.answer, result.toolCalls);
    } catch (error) {
      if (error instanceof TurnCancelledError) {
        throw error;
      }

      if (error instanceof ApprovalRequiredError) {
        this.logger.warn(
          `Workflow "${workflow.id}" tạm dừng chờ HITL approval cho tool "${error.pendingTool.name}"`,
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
              agent: workflow.id,
              task: prompt,
              result: `Workflow "${workflow.name}" yêu cầu phê duyệt cho thao tác: ${error.pendingTool.name}`,
            },
          ],
          error.toolCalls,
          history,
          approvalNeeded,
          [],
        );
      }

      this.logger.error(
        `Lỗi thực thi fixed workflow "${workflow.id}": ${(error as Error).message}`,
        (error as Error).stack,
      );
      throw error;
    }
  }
}
