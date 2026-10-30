import { Injectable, Logger } from '@nestjs/common';
import {
  DEFAULT_AGGREGATOR_SYSTEM_PROMPT,
  ORCHESTRATION_CONSTANTS,
} from '@agent/core/constants';
import {
  EngineRoutingContext,
  EngineExecutionContext,
  EExecutionEngineMode,
} from '../../../contracts/engine/execution-engine.interface';
import {
  IParallelFanoutEngine,
  FanoutDefinition,
  FanoutWorkerDefinition,
  FanoutWorkerResult,
  PARALLEL_FANOUT_REGEX,
} from '../../../contracts/engine/parallel-fanout.interface';
import {
  AnswerResult,
  buildAnswer,
} from '../../../contracts/engine/orchestration-answer.types';
import { ReactLoopService } from '../../loop/react-loop.service';
import { AgentCancellationService } from '../../cancellation/agent-cancellation.service';
import { assertNotCancelled } from '../../cancellation/assert-not-cancelled.util';
import { MetricsRegistryService } from '../../../infrastructure/resilience/metrics-registry.service';
import { TurnCancelledError } from '../../loop/errors/turn-cancelled.error';
import {
  RunReactLoopRequestDto,
  ToolCallTraceDto,
} from '../../../contracts/dtos/react-loop.dto';
import { ExecutedStepDto } from '../../../contracts/dtos/message-client.dto';
import { LlmStrategyFactory } from '../../strategy/llm-strategy.factory';
import { buildReactRequestIdentity } from '../utils/react-request-identity.util';
import {
  buildAggregatorNoSuccessMessage,
  buildFanoutAllFailedAnswer,
} from './utils/engine-prompt.util';

const DEFAULT_MAX_CONCURRENCY = 8;

/**
 * ParallelFanoutEngine
 *
 * Engine thực thi Fan-Out / Sub-Agent song song (Nhánh 3 trong Master Blueprint: chiếm 5-10% tác vụ).
 * Chạy đồng thời nhiều Worker Agent độc lập qua Promise.all với concurrency guard,
 * sau đó bơm toàn bộ kết quả vào 1 Aggregator Model (Model xịn) để tổng hợp báo cáo cuối.
 */
@Injectable()
/**
 * @deprecated Từ kiến trúc Two-Engine Architecture, hãy sử dụng DeterministicEngine.
 * Class này được giữ lại làm alias/fallback tương thích ngược cho các unit tests và checkpoints cũ.
 */
export class ParallelFanoutEngine implements IParallelFanoutEngine {
  readonly id = EExecutionEngineMode.PARALLEL_FANOUT;
  readonly name = 'Parallel Fan-Out & Aggregator Engine';
  readonly priority = 15;

  private readonly logger = new Logger(ParallelFanoutEngine.name);

  constructor(
    private readonly reactLoop: ReactLoopService,
    private readonly cancellation: AgentCancellationService,
    private readonly metrics: MetricsRegistryService,
    private readonly llmFactory: LlmStrategyFactory,
  ) {}

  canHandle(context: EngineRoutingContext): boolean {
    if (context.forcedMode === 'fanout') return true;
    if (context.forcedMode && context.forcedMode !== 'auto') return false;
    if (context.metadata?.fanout) return true;
    return PARALLEL_FANOUT_REGEX.test(context.prompt);
  }

  async execute(context: EngineExecutionContext): Promise<AnswerResult> {
    const fanout = context.metadata?.fanout as FanoutDefinition | undefined;
    if (!fanout) {
      throw new Error('[ParallelFanoutEngine] FanoutDefinition phải được truyền qua context.metadata.fanout');
    }
    return this.executeFanout(fanout, context);
  }

  async executeFanout(
    fanout: FanoutDefinition,
    context: EngineExecutionContext,
  ): Promise<AnswerResult> {
    const { data, replyMessageId, prompt, agents, history, signal } = context;
    const connectedProviders = (agents ?? []).map((a) => a.provider);
    const maxConcurrency = fanout.maxConcurrency ?? DEFAULT_MAX_CONCURRENCY;

    this.logger.log(
      `Bắt đầu Fan-Out "${fanout.id}" (${fanout.name}) cho turn ${replyMessageId} [${fanout.workers.length} workers, maxConcurrency=${maxConcurrency}]`,
    );

    // 1. Kiểm tra cờ hủy trước khi khởi động bất kỳ worker nào
    await assertNotCancelled(this.cancellation, replyMessageId, signal);

    // 2. Phân nhóm workers theo batch concurrency (tránh quá tải rate-limit)
    const workerResults: FanoutWorkerResult[] = [];
    const allToolCalls: ToolCallTraceDto[] = [];
    const batches = this.chunkWorkers(fanout.workers, maxConcurrency);

    for (const batch of batches) {
      const batchStart = Date.now();
      this.logger.log(
        `[Fan-Out: ${fanout.id}] Chạy batch ${batch.map((w) => w.name).join(' | ')} đồng thời`,
      );

      // 3. Chạy từng batch song song
      const batchResults = await Promise.all(
        batch.map((worker) =>
          this.runWorker(worker, { data, replyMessageId, prompt, connectedProviders, signal }),
        ),
      );

      for (const result of batchResults) {
        workerResults.push(result);
        if (result.toolCalls) allToolCalls.push(...result.toolCalls);
      }

      const elapsed = Date.now() - batchStart;
      this.logger.log(
        `[Fan-Out: ${fanout.id}] Batch hoàn tất trong ${elapsed}ms — ${batchResults.filter((r) => r.success).length}/${batch.length} workers thành công`,
      );
    }

    // 4. Short-circuit: Nếu 100% worker thất bại thì không gọi Aggregator để tiết kiệm chi phí
    const successfulWorkers = workerResults.filter((r) => r.success);
    if (successfulWorkers.length === 0 && workerResults.length > 0) {
      this.logger.warn(
        `[Fan-Out: ${fanout.id}] Toàn bộ ${workerResults.length} worker đều thất bại, hủy gọi Aggregator để tiết kiệm token`,
      );
      const failAnswer = buildFanoutAllFailedAnswer(workerResults);
      const failSteps: ExecutedStepDto[] = workerResults.map((r) => ({
        agent: r.workerId,
        task: `[Worker] ${r.workerName}`,
        persona: { role: r.workerName, goal: `Thu thập dữ liệu từ ${r.workerName}` },
        toolCalls: r.toolCalls ?? [],
        result: `[Lỗi] ${r.error}`,
      }));
      return buildAnswer(failAnswer, allToolCalls, failSteps);
    }

    // 5. Gom kết quả và bơm vào Aggregator
    const aggregatorResult = await this.runAggregator({
      fanout,
      prompt,
      workerResults,
      replyMessageId,
      signal,
    });

    // 5. Đóng gói ExecutedStep: từng worker + aggregator
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
        task: `[Aggregator] Tổng hợp ${workerResults.length} nguồn dữ liệu`,
        persona: { role: 'Aggregator Agent', goal: 'Tổng hợp và so sánh kết quả đa nguồn' },
        toolCalls: [],
        result: aggregatorResult,
      },
    ];

    this.logger.log(
      `Hoàn tất Fan-Out "${fanout.id}" cho turn ${replyMessageId} — Aggregator đã tổng hợp`,
    );

    this.metrics.incrementBehaviorSignal('parallel_fanout_completed');

    return buildAnswer(aggregatorResult, allToolCalls, executedSteps);
  }

  private async runWorker(
    worker: FanoutWorkerDefinition,
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

    const workerMessageId = `${replyMessageId}:fanout:${worker.id}`;
    const provider = worker.provider ?? connectedProviders[0] ?? 'compute';
    const start = Date.now();

    this.logger.log(
      `[Worker] Đang chạy worker "${worker.name}" (id=${worker.id}, provider=${provider})`,
    );

    const requestDto: RunReactLoopRequestDto = {
      prompt: workerPrompt,
      provider,
      providers: [provider],
      ...buildReactRequestIdentity(data),
      messageId: workerMessageId,
      history: [], // Mỗi worker cô lập hoàn toàn, không chia sẻ lịch sử
      model: process.env.WORKER_TIER_MODEL ?? process.env.DEFAULT_REACT_MODEL ?? ORCHESTRATION_CONSTANTS.DEFAULT_REACT_MODEL,
      persona: {
        role: worker.name,
        goal: `Thu thập và xử lý dữ liệu từ ${worker.name}`,
      },
      allowedTools: worker.tools ? [...worker.tools] : undefined,
      streamKey: workerMessageId, // Stream key riêng để FE không gộp nhầm
    };

    try {
      const result = await this.reactLoop.run(requestDto, signal);
      const durationMs = Date.now() - start;

      this.logger.log(
        `[Worker] "${worker.name}" hoàn thành trong ${durationMs}ms`,
      );

      return {
        workerId: worker.id,
        workerName: worker.name,
        success: true,
        output: result.answer,
        toolCalls: result.toolCalls,
        durationMs,
      };
    } catch (error) {
      if (error instanceof TurnCancelledError) {
        throw error;
      }

      const durationMs = Date.now() - start;
      this.logger.error(
        `[Worker] "${worker.name}" gặp lỗi sau ${durationMs}ms: ${(error as Error)?.message}`,
      );

      // Worker lỗi KHÔNG dừng toàn bộ fan-out — ghi nhận và tiếp tục
      return {
        workerId: worker.id,
        workerName: worker.name,
        success: false,
        output: '',
        error: (error as Error)?.message,
        durationMs,
      };
    }
  }

  private async runAggregator(opts: {
    fanout: FanoutDefinition;
    prompt: string;
    workerResults: FanoutWorkerResult[];
    replyMessageId: string;
    signal?: AbortSignal;
  }): Promise<string> {
    const { fanout, prompt, workerResults, signal } = opts;
    const successfulResults = workerResults.filter((r) => r.success);

    if (successfulResults.length === 0) {
      this.logger.warn(
        `[Aggregator] Không có worker nào thành công trong fan-out "${fanout.id}", trả về thông báo lỗi`,
      );
      return buildAggregatorNoSuccessMessage(workerResults.length);
    }

    const aggregatorModel =
      fanout.aggregatorModel ??
      process.env.AGGREGATOR_MODEL ??
      process.env.PREMIUM_TIER_MODEL ??
      ORCHESTRATION_CONSTANTS.DEFAULT_REACT_MODEL;

    const systemPrompt =
      fanout.aggregatorSystemPrompt ?? DEFAULT_AGGREGATOR_SYSTEM_PROMPT;

    // Cấu trúc prompt tổng hợp rõ ràng từng nguồn
    const workerSummaries = workerResults
      .map((r) =>
        r.success
          ? `### Nguồn: ${r.workerName}\n${r.output}`
          : `### Nguồn: ${r.workerName}\n[Không lấy được dữ liệu: ${r.error}]`,
      )
      .join('\n\n---\n\n');

    const aggregatorPrompt = [
      `Yêu cầu ban đầu của người dùng: "${prompt}"`,
      '',
      `Dữ liệu thu thập được từ ${workerResults.length} nguồn:`,
      '',
      workerSummaries,
      '',
      'Hãy tổng hợp thành câu trả lời hoàn chỉnh.',
    ].join('\n');

    this.logger.log(
      `[Aggregator] Tổng hợp ${successfulResults.length}/${workerResults.length} nguồn thành công bằng model="${aggregatorModel}"`,
    );

    const { strategy, model } = this.llmFactory.resolve(aggregatorModel);
    const session = strategy.startChat({
      model,
      systemInstruction: systemPrompt,
      tools: [],
      history: [],
    });

    const turnResult = await session.sendMessage(aggregatorPrompt, undefined, signal);
    return turnResult.text ?? '';
  }

  /**
   * Chia danh sách workers thành các batch có kích thước maxConcurrency
   */
  private chunkWorkers(
    workers: readonly FanoutWorkerDefinition[],
    size: number,
  ): FanoutWorkerDefinition[][] {
    const chunks: FanoutWorkerDefinition[][] = [];
    for (let i = 0; i < workers.length; i += size) {
      chunks.push([...workers.slice(i, i + size)]);
    }
    return chunks;
  }
}
