import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { IProcessAiTriggerJobData } from '@agent/core/infrastructure/queue';
import { ORCHESTRATION_CONSTANTS } from '@agent/core/constants';
import {
  IMessageSink,
  MESSAGE_SINK,
  IStreamSink,
  STREAM_SINK,
  IWorkflowRegistry,
  WORKFLOW_REGISTRY,
  WORKFLOW_RUNNER,
} from '../../contracts';
import { ReactLoopService } from '../loop/react-loop.service';
import { SupervisorService } from '../supervisor/supervisor.service';
import { WorkflowRunnerService } from '../workflow/workflow-runner.service';
import {
  AvailableAgentDto,
  DelegationDto,
  SupervisorRoundDto,
} from '../../contracts/dtos/supervisor.dto';
import {
  ToolCallTraceDto,
  RunReactLoopRequestDto,
} from '../../contracts/dtos/react-loop.dto';
import {
  ChatHistoryTurnDto,
  ExecutedStepDto,
} from '../../contracts/dtos/message-client.dto';
import { AgentCancellationService } from '../cancellation/agent-cancellation.service';
import { runCancellable } from '../../common/cancellable-run.util';
import { TurnCancelledError } from '../loop/turn-cancelled.error';
import { ApprovalRequiredError } from '../loop/approval-required.error';
import { CheckpointPauseService } from '../hitl/checkpoint-pause.service';
import { MetricsRegistryService } from '../../common/metrics-registry.service';
import {
  AnswerResult,
  ApprovalRequiredDelegateResult,
  buildAnswer,
} from './orchestration-answer.types';
import { TurnResolverRun } from './turn-resolver-run';
import { MemoryManagerService } from '../../memory/memory-manager.service';
import {
  decideExecutionMode,
  EExecutionMode,
} from './hybrid-execution-router.util';

// Ghi chú thiết kế đầy đủ (WHY): docs/orchestration/code-notes/turn-resolver.service.md
// Logic chi tiết 1 turn (plan/delegate/evaluate/synthesize) nằm ở
// TurnResolverRun (turn-resolver-run.ts) — file này chỉ dựng dependencies
// rồi giao việc, giữ nguyên API công khai (continueRounds()/resolveAnswer())
// vì ApprovalFlowService/CheckpointPauseService gọi thẳng vào đây.
@Injectable()
export class TurnResolverService {
  private readonly logger = new Logger(TurnResolverService.name);

  constructor(
    @Inject(MESSAGE_SINK)
    private readonly messageSink: IMessageSink,
    private readonly reactLoop: ReactLoopService,
    private readonly supervisor: SupervisorService,
    @Inject(STREAM_SINK)
    private readonly streamSink: IStreamSink,
    private readonly cancellation: AgentCancellationService,
    private readonly checkpointPause: CheckpointPauseService,
    private readonly metrics: MetricsRegistryService,
    private readonly memoryManager: MemoryManagerService,
    @Optional()
    @Inject(WORKFLOW_REGISTRY)
    private readonly workflowRegistry?: IWorkflowRegistry,
    @Optional()
    @Inject(WORKFLOW_RUNNER)
    private readonly workflowRunner?: WorkflowRunnerService,
  ) {}

  private get messageClient(): IMessageSink {
    return this.messageSink;
  }

  private get agentStream(): IStreamSink {
    return this.streamSink;
  }

  async resolveAnswer(
    data: IProcessAiTriggerJobData,
    replyMessageId: string,
  ): Promise<AnswerResult> {
    const { userId, channelId, messageId, workspaceId, workflowId } = data;
    const [prompt, agents, history] = await Promise.all([
      this.messageSink.getMessageText({ id: messageId, userId }),
      this.supervisor.getAvailableAgents(userId, workspaceId),
      this.messageSink.getRecentHistory({
        channelId,
        userId,
        beforeMessageId: messageId,
        limit: ORCHESTRATION_CONSTANTS.CHAT_HISTORY_LIMIT,
        charBudget: this.memoryManager.buildBudget(
          process.env.DEFAULT_REACT_MODEL ??
            ORCHESTRATION_CONSTANTS.DEFAULT_REACT_MODEL,
        ).historyCharBudget,
      }),
    ]);

    if (workflowId && this.workflowRegistry && this.workflowRunner) {
      const workflow = this.workflowRegistry.get(workflowId);
      if (workflow) {
        this.logger.log(
          `Routing trực tiếp tới fixed workflow "${workflowId}" (${workflow.name}) cho turn ${replyMessageId}`,
        );
        return this.workflowRunner.runWorkflow({
          workflow,
          prompt,
          data,
          replyMessageId,
          history,
        });
      }
      this.logger.warn(
        `Không tìm thấy workflowId="${workflowId}" trong registry. Fallback về Dynamic Supervisor.`,
      );
    }

    // Hybrid Orchestration: Định tuyến thông minh giữa Single Agent & Multi-Agent Supervisor
    const orchestrationMode =
      process.env.DEFAULT_ORCHESTRATION_MODE ?? 'hybrid';

    if (orchestrationMode !== 'supervisor') {
      const decision = decideExecutionMode({
        prompt,
        forcedMode: orchestrationMode === 'single' ? 'single' : 'auto',
      });
      this.logger.log(
        `[Hybrid Router] turn=${replyMessageId} mode=${decision.mode} reason="${decision.reason}" agentsConnected=${agents.length}`,
      );

      // Mặc định (85-90% yêu cầu): Chạy qua Multi-Provider Single Agent (1 context duy nhất, nhanh & rẻ)
      if (decision.mode === EExecutionMode.SINGLE_AGENT && agents.length > 0) {
        return this.runSingleAgentTurn({
          data,
          replyMessageId,
          prompt,
          agents,
          history,
        });
      }
    }

    return this.continueRounds(
      data,
      replyMessageId,
      prompt,
      agents,
      history,
      [],
      [],
    );
  }

  private async runSingleAgentTurn(options: {
    data: IProcessAiTriggerJobData;
    replyMessageId: string;
    prompt: string;
    agents: AvailableAgentDto[];
    history: ChatHistoryTurnDto[];
    signal?: AbortSignal;
  }): Promise<AnswerResult> {
    const { data, replyMessageId, prompt, agents, history, signal } = options;
    const connectedProviders = agents.map((a) => a.provider);
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

  async continueRounds(
    data: IProcessAiTriggerJobData,
    replyMessageId: string,
    prompt: string,
    agents: AvailableAgentDto[],
    history: ChatHistoryTurnDto[],
    rounds: SupervisorRoundDto[],
    toolCalls: ToolCallTraceDto[],
    forcedStep?: DelegationDto,
    remainingSteps?: DelegationDto[],
    signal?: AbortSignal,
  ): Promise<AnswerResult> {
    const runTurn = (sig?: AbortSignal) =>
      new TurnResolverRun(
        {
          data,
          replyMessageId,
          prompt,
          agents,
          history,
          rounds,
          toolCalls,
          signal: sig,
        },
        {
          reactLoop: this.reactLoop,
          supervisor: this.supervisor,
          streamSink: this.streamSink,
          agentStream: this.streamSink,
          cancellation: this.cancellation,
          checkpointPause: this.checkpointPause,
          metrics: this.metrics,
          memoryManager: this.memoryManager,
          logger: this.logger,
        },
      ).run(forcedStep, remainingSteps);

    if (signal) {
      return runTurn(signal);
    }

    return runCancellable(
      replyMessageId,
      this.cancellation,
      (sig) => runTurn(sig),
      () => {
        const partialText =
          rounds.length > 0 ? rounds[rounds.length - 1].result : undefined;
        return new TurnCancelledError(partialText);
      },
    );
  }
}
