import { Inject, Injectable, Logger } from '@nestjs/common';
import { IProcessAiTriggerJobData } from '@agent/core/infrastructure/queue';
import { ORCHESTRATION_CONSTANTS } from '@agent/core/constants';
import {
  IMessageSink,
  MESSAGE_SINK,
  IStreamSink,
  STREAM_SINK,
} from '../../contracts';
import { ReactLoopService } from '../loop/react-loop.service';
import { SupervisorService } from '../supervisor/supervisor.service';
import {
  AvailableAgentDto,
  DelegationDto,
  SupervisorRoundDto,
} from '../../contracts/dtos/supervisor.dto';
import { ToolCallTraceDto } from '../../contracts/dtos/react-loop.dto';
import { ChatHistoryTurnDto } from '../../contracts/dtos/message-client.dto';
import { AgentCancellationService } from '../cancellation/agent-cancellation.service';
import { runCancellable } from '../../common/cancellable-run.util';
import { TurnCancelledError } from '../loop/turn-cancelled.error';
import { CheckpointPauseService } from '../hitl/checkpoint-pause.service';
import { MetricsRegistryService } from '../../common/metrics-registry.service';
import { AnswerResult } from './orchestration-answer.types';
import { TurnResolverRun } from './turn-resolver-run';
import { MemoryManagerService } from '../../memory/memory-manager.service';

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
    const { userId, channelId, messageId, workspaceId } = data;
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
