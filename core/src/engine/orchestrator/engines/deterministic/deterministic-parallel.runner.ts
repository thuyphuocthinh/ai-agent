import { Injectable, Logger } from '@nestjs/common';
import {
  DEFAULT_AGGREGATOR_SYSTEM_PROMPT,
  ORCHESTRATION_CONSTANTS,
} from '@agent/core/constants';
import {
  AnswerResult,
  ApprovalRequiredDelegateResult,
  buildAnswer,
} from '../../../../contracts/engine/orchestration-answer.types';
import {
  EExecutionEngineMode,
  EngineExecutionContext,
} from '../../../../contracts/engine/execution-engine.interface';
import {
  DeterministicParallelConfig,
  DeterministicWorkerConfig,
} from '../../../../contracts/engine/deterministic-graph.interface';
import {
  FanoutDefinition,
  FanoutWorkerResult,
} from '../../../../contracts/engine/parallel-fanout.interface';
import { ReactLoopService } from '../../../loop/react-loop.service';
import { AgentCancellationService } from '../../../cancellation/agent-cancellation.service';
import { assertNotCancelled } from '../../../cancellation/assert-not-cancelled.util';
import { CheckpointPauseService } from '../../../hitl/checkpoint-pause.service';
import { TurnCancelledError } from '../../../loop/errors/turn-cancelled.error';
import { ApprovalRequiredError } from '../../../loop/errors/approval-required.error';
import {
  RunReactLoopRequestDto,
  ToolCallTraceDto,
} from '../../../../contracts/dtos/react-loop.dto';
import { ExecutedStepDto } from '../../../../contracts/dtos/message-client.dto';
import { buildReactRequestIdentity } from '../../utils/react-request-identity.util';
import { LlmStrategyFactory } from '../../../strategy/llm-strategy.factory';
import { buildFanoutAllFailedAnswer } from '../utils/engine-prompt.util';
import { buildFanoutAggregatorPrompt } from '../utils/pipeline-prompt.util';

const DEFAULT_MAX_CONCURRENCY = 8;

/**
 * DeterministicParallelRunner
 *
 * Chịu trách nhiệm thực thi Node Chạy song song Fork-Join (Fan-out) trong Deterministic Engine.
 * TÍCH HỢP SAFE HITL GUARD: Khi bất kỳ worker nào gặp tool rủi ro đòi duyệt,
 * lập tức tạm dừng an toàn cả cụm, lưu checkpoint và không nuốt chửng lỗi.
 */
@Injectable()
export class DeterministicParallelRunner {
  private readonly logger = new Logger(DeterministicParallelRunner.name);

  constructor(
    private readonly reactLoop: ReactLoopService,
    private readonly cancellation: AgentCancellationService,
    private readonly checkpointPause: CheckpointPauseService,
    private readonly llmFactory: LlmStrategyFactory,
  ) {}

  async run(
    config: DeterministicParallelConfig,
    context: EngineExecutionContext,
  ): Promise<AnswerResult> {
    const { data, replyMessageId, prompt, agents, signal } = context;
    const connectedProviders = (agents ?? []).map((a) => a.provider);
    const maxConcurrency = config.maxConcurrency ?? DEFAULT_MAX_CONCURRENCY;

    this.logger.log(
      `[DeterministicParallelRunner] Chạy cụm song song "${config.id}" (${config.workers.length} workers, concurrency=${maxConcurrency})`,
    );

    const workerResults: FanoutWorkerResult[] = [];
    const allToolCalls: ToolCallTraceDto[] = [];
    const batches = this.chunkArray(config.workers, maxConcurrency);

    for (const batch of batches) {
      await assertNotCancelled(this.cancellation, replyMessageId, signal);

      try {
        const batchResults = await Promise.all(
          batch.map((worker) =>
            this.runWorker(worker, {
              data,
              replyMessageId,
              prompt,
              connectedProviders,
              signal,
            }),
          ),
        );

        for (const res of batchResults) {
          workerResults.push(res);
          if (res.toolCalls) allToolCalls.push(...res.toolCalls);
        }
      } catch (error) {
        // Safe HITL Guard
        if (error instanceof ApprovalRequiredError) {
          this.logger.warn(
            `[DeterministicParallelRunner] Safe HITL Guard: Tạm dừng an toàn cụm "${config.id}" chờ duyệt tool "${error.pendingTool.name}"`,
          );
          const approvalNeeded: ApprovalRequiredDelegateResult = {
            approvalRequired: error.pendingTool,
            task: `Parallel Worker: ${error.pendingTool.name}`,
            toolCalls: error.toolCalls,
          };
          return this.checkpointPause.pauseForApproval(
            data,
            prompt,
            workerResults.map((r) => ({
              agent: r.workerId,
              task: r.workerName,
              result: r.success ? r.output : `[Lỗi] ${r.error}`,
            })),
            [...allToolCalls, ...(error.toolCalls ?? [])],
            context.history,
            approvalNeeded,
            [],
            EExecutionEngineMode.DETERMINISTIC,
          );
        }
        throw error;
      }
    }

    // Short-circuit nếu 100% worker thất bại
    const successfulWorkers = workerResults.filter((r) => r.success);
    if (successfulWorkers.length === 0 && workerResults.length > 0) {
      const failAnswer = buildFanoutAllFailedAnswer(workerResults);
      return buildAnswer(failAnswer, allToolCalls);
    }

    // Tổng hợp kết quả bằng Aggregator Model
    const aggregatorResult = await this.runAggregator({
      config,
      prompt,
      workerResults,
      replyMessageId,
      signal,
    });

    const executedSteps: ExecutedStepDto[] = [
      ...workerResults.map((r) => ({
        agent: r.workerId,
        task: `[Worker] ${r.workerName}`,
        persona: { role: r.workerName, goal: `Thu thập dữ liệu từ ${r.workerName}` },
        toolCalls: r.toolCalls ?? [],
        result: r.success ? r.output : `[Lỗi] ${r.error}`,
      })),
      {
        agent: 'aggregator',
        task: `[Aggregator] Tổng hợp ${workerResults.length} nguồn`,
        persona: { role: 'Aggregator Agent', goal: 'Tổng hợp so sánh kết quả đa nguồn' },
        toolCalls: [],
        result: aggregatorResult,
      },
    ];

    return buildAnswer(aggregatorResult, allToolCalls, executedSteps);
  }

  /**
   * Tương thích ngược: thực thi FanoutDefinition trực tiếp
   */
  async executeFanout(
    fanout: FanoutDefinition,
    context: EngineExecutionContext,
  ): Promise<AnswerResult> {
    return this.run(
      {
        id: fanout.id,
        name: fanout.name,
        workers: fanout.workers.map((w) => ({
          id: w.id,
          name: w.name,
          prompt: w.prompt,
          provider: w.provider,
          tools: w.tools,
        })),
        maxConcurrency: fanout.maxConcurrency,
        aggregatorModel: fanout.aggregatorModel,
      },
      context,
    );
  }

  private async runWorker(
    worker: DeterministicWorkerConfig,
    opts: {
      data: EngineExecutionContext['data'];
      replyMessageId: string;
      prompt: string;
      connectedProviders: string[];
      signal?: AbortSignal;
    },
  ): Promise<FanoutWorkerResult> {
    const { data, replyMessageId, prompt, connectedProviders, signal } = opts;
    const workerPrompt = worker.prompt
      ? worker.prompt.replaceAll('{{input}}', () => prompt)
      : prompt;
    const workerMessageId = `${replyMessageId}:worker:${worker.id}`;
    const provider = worker.provider ?? connectedProviders[0] ?? 'compute';
    const start = Date.now();

    const requestDto: RunReactLoopRequestDto = {
      prompt: workerPrompt,
      provider,
      providers: [provider],
      ...buildReactRequestIdentity(data),
      messageId: workerMessageId,
      history: [],
      model: worker.model ?? process.env.WORKER_TIER_MODEL ?? ORCHESTRATION_CONSTANTS.DEFAULT_REACT_MODEL,
      persona: { role: worker.name, goal: `Thu thập dữ liệu từ ${worker.name}` },
      allowedTools: worker.tools ? [...worker.tools] : undefined,
      streamKey: workerMessageId,
    };

    try {
      const result = await this.reactLoop.run(requestDto, signal);
      return {
        workerId: worker.id,
        workerName: worker.name,
        success: true,
        output: result.answer,
        toolCalls: result.toolCalls,
        durationMs: Date.now() - start,
      };
    } catch (error) {
      if (error instanceof TurnCancelledError || error instanceof ApprovalRequiredError) {
        throw error;
      }
      return {
        workerId: worker.id,
        workerName: worker.name,
        success: false,
        output: '',
        error: (error as Error)?.message,
        durationMs: Date.now() - start,
      };
    }
  }

  private async runAggregator(opts: {
    config: DeterministicParallelConfig;
    prompt: string;
    workerResults: FanoutWorkerResult[];
    replyMessageId: string;
    signal?: AbortSignal;
  }): Promise<string> {
    const { config, prompt, workerResults, replyMessageId, signal } = opts;
    const resultsSummary = workerResults
      .map((r) => `=== [NGUỒN: ${r.workerName} (${r.workerId})] ===\n${r.success ? r.output : `[LỖI] ${r.error}`}`)
      .join('\n\n');

    const aggregatorPrompt = buildFanoutAggregatorPrompt(prompt, resultsSummary);
    const aggregatorModel = config.aggregatorModel ?? process.env.PREMIUM_TIER_MODEL ?? process.env.DEFAULT_REACT_MODEL ?? ORCHESTRATION_CONSTANTS.DEFAULT_REACT_MODEL;

    const { strategy, model } = this.llmFactory.resolve(aggregatorModel);
    const session = strategy.startChat({
      model,
      systemInstruction: config.aggregatorPrompt ?? DEFAULT_AGGREGATOR_SYSTEM_PROMPT,
      tools: [],
      history: [],
    });

    const turnResult = await session.sendMessage(aggregatorPrompt, undefined, signal);
    return turnResult.text ?? '';
  }

  private chunkArray<T>(items: readonly T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < items.length; i += size) {
      chunks.push(items.slice(i, i + size) as T[]);
    }
    return chunks;
  }
}
