import { Injectable, Logger, Inject, Optional } from '@nestjs/common';
import {
  IExecutionEngine,
  EngineRoutingContext,
  EngineExecutionContext,
  EExecutionEngineMode,
} from '../../../contracts/engine/execution-engine.interface';
import { AnswerResult } from '../../../contracts/engine/orchestration-answer.types';
import { CheckpointResponseDto } from '../../../contracts/dtos/checkpoint.dto';
import { ECheckpointKind, ORCHESTRATION_CONSTANTS } from '@agent/core/constants';
import { SupervisorService } from '../../supervisor/supervisor.service';
import { ApprovalContinuationPlannerService } from '../../hitl/approval-continuation-planner.service';
import {
  TOOL_PROVIDER,
  IToolProvider,
  IStreamSink,
  STREAM_SINK,
} from '../../../contracts';
import { extractTextFromMcpResult } from '../../../common';
import { capToolResultSize } from '../../../common/text/token-budget.util';
import {
  AvailableAgentDto,
  DelegationDto,
  SupervisorRoundDto,
} from '../../../contracts/dtos/supervisor.dto';
import { ToolCallTraceDto } from '../../../contracts/dtos/react-loop.dto';
import { ChatHistoryTurnDto } from '../../../contracts/dtos/message-client.dto';
import { IProcessAiTriggerJobData } from '@agent/core/infrastructure/queue';
import { ReactLoopService } from '../../loop/react-loop.service';
import { AgentCancellationService } from '../../cancellation/agent-cancellation.service';
import { CheckpointPauseService } from '../../hitl/checkpoint-pause.service';
import { MetricsRegistryService } from '../../../infrastructure/resilience/metrics-registry.service';
import { MemoryManagerService } from '../../../memory/memory-manager.service';
import { CheckpointService } from '../../hitl/checkpoint.service';
import { TurnResolverRun } from '../turn/turn-resolver-run';
import { runCancellable } from '../../cancellation/cancellable-run.util';
import { TurnCancelledError } from '../../loop/errors/turn-cancelled.error';
import { buildApprovedToolFailureMessage } from './utils/engine-prompt.util';

/**
 * DynamicSupervisorEngine
 *
 * Engine thực thi Multi-Agent Dynamic Supervisor (Nhánh 3 trong Master Blueprint).
 * Lập kế hoạch động, phân công tác vụ cho các chuyên viên Sub-Agents và tổng hợp kết quả cuối cùng.
 * Hoàn toàn độc lập, là 1 Execution Engine trong Registry, không phụ thuộc TurnResolverService.
 */
@Injectable()
export class DynamicSupervisorEngine implements IExecutionEngine {
  readonly id = EExecutionEngineMode.DYNAMIC_SUPERVISOR;
  readonly name = 'Dynamic Multi-Agent Supervisor';
  readonly priority = 5;

  private readonly logger = new Logger(DynamicSupervisorEngine.name);

  constructor(
    private readonly reactLoop: ReactLoopService,
    private readonly supervisor: SupervisorService,
    @Inject(STREAM_SINK)
    private readonly streamSink: IStreamSink,
    private readonly cancellation: AgentCancellationService,
    private readonly checkpointPause: CheckpointPauseService,
    private readonly metrics: MetricsRegistryService,
    private readonly memoryManager: MemoryManagerService,
    private readonly continuationPlanner: ApprovalContinuationPlannerService,
    @Inject(TOOL_PROVIDER)
    private readonly toolProvider: IToolProvider,
    @Optional()
    private readonly checkpointService?: CheckpointService,
  ) {}

  canHandle(context: EngineRoutingContext): boolean {
    return context.forcedMode === 'supervisor';
  }

  async execute(context: EngineExecutionContext): Promise<AnswerResult> {
    return this.continueRounds(
      context.data,
      context.replyMessageId,
      context.prompt,
      context.agents,
      context.history,
      [],
      [],
      undefined,
      undefined,
      context.signal,
    );
  }

  async resume(checkpoint: CheckpointResponseDto): Promise<AnswerResult> {
    const { userId, workspaceId } = checkpoint;
    const agents = await this.supervisor.getAvailableAgents(userId, workspaceId);
    const triggerData = this.buildTriggerData(checkpoint);

    // 1. Trường hợp Clarification (chọn giữa 2 agents mập mờ, VD: Notion vs Google Docs)
    if (checkpoint.kind === ECheckpointKind.CLARIFICATION) {
      return this.resumeClarification(checkpoint, triggerData, agents);
    }

    // 2. Trường hợp Approval (duyệt thao tác ghi/xóa rủi ro của Sub-Agent)
    return this.resumeApproval(checkpoint, triggerData, agents);
  }

  private buildTriggerData(
    checkpoint: CheckpointResponseDto,
  ): IProcessAiTriggerJobData {
    return {
      userId: checkpoint.userId,
      channelId: checkpoint.channelId,
      workspaceId: checkpoint.workspaceId,
      messageId: checkpoint.replyMessageId,
      botUserId: checkpoint.botUserId,
      channelType: checkpoint.channelType,
      sessionType: checkpoint.sessionType,
      conversationId: checkpoint.conversationId,
    };
  }

  private resumeClarification(
    checkpoint: CheckpointResponseDto,
    triggerData: IProcessAiTriggerJobData,
    agents: AvailableAgentDto[],
  ): Promise<AnswerResult> {
    const forcedStep: DelegationDto = {
      agent: checkpoint.selectedProvider!,
      task: checkpoint.pendingTask,
    };

    this.logger.log(
      `[DynamicSupervisorEngine] Resume Clarification cho turn ${checkpoint.replyMessageId}: ép agent ${forcedStep.agent}`,
    );

    return this.continueRounds(
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

  private async resumeApproval(
    checkpoint: CheckpointResponseDto,
    triggerData: IProcessAiTriggerJobData,
    agents: AvailableAgentDto[],
  ): Promise<AnswerResult> {
    const { userId, replyMessageId, workspaceId } = checkpoint;
    const pendingTool = checkpoint.pendingTool;
    if (!pendingTool) {
      throw new Error('Checkpoint approval thiếu thông tin pendingTool');
    }

    this.logger.log(
      `[DynamicSupervisorEngine] Resume Approval cho turn ${replyMessageId}: thực thi tool ${pendingTool.provider}.${pendingTool.name}`,
    );

    const toolResult = await this.toolProvider.callTool({
      provider: pendingTool.provider,
      name: pendingTool.name,
      args: pendingTool.args,
      ownerId: userId,
      workspaceId,
    });

    const toolResultText = extractTextFromMcpResult(toolResult);

    await this.checkpointService?.markToolExecuted({ id: checkpoint.id });

    if (toolResult.isError) {
      const errorMessage = buildApprovedToolFailureMessage(
        pendingTool.name,
        toolResultText,
      );
      return {
        content: errorMessage,
      };
    }

    const { remainingSteps, resultText } =
      await this.continuationPlanner.resolveRemainingSteps(
        checkpoint,
        toolResultText,
      );

    const budget = this.memoryManager.buildBudget(
      process.env.DEFAULT_REACT_MODEL ??
        ORCHESTRATION_CONSTANTS.DEFAULT_REACT_MODEL,
    );
    const cappedResult = capToolResultSize(
      resultText,
      budget.toolResultCharBudget,
    );

    const rounds = [
      ...checkpoint.roundsSoFar,
      {
        agent: pendingTool.provider,
        task: checkpoint.pendingTask,
        result: cappedResult,
      },
    ];

    return this.continueRounds(
      triggerData,
      replyMessageId,
      checkpoint.originalPrompt,
      agents,
      checkpoint.history,
      rounds,
      [],
      undefined,
      remainingSteps,
    );
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
