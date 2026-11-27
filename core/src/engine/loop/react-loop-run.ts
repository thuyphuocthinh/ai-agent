import { Logger } from '@nestjs/common';
import {
  DEFAULT_EMPTY_ANSWER,
  EStepExecutionStatus,
  ORCHESTRATION_CONSTANTS,
  ORCHESTRATION_SELF_CHECK_PROMPT,
} from '@agent/core/constants';
import {
  RunReactLoopRequestDto,
  RunReactLoopResponseDto,
  ToolCallTraceDto,
} from '../../contracts/dtos/react-loop.dto';
import { checkQuantity as checkQuantityUtil } from './guards/quantity-check.util';
import {
  LlmChatSession,
  LlmStrategy,
  LlmToolResult,
  LlmTurnResult,
} from '../../contracts/engine/llm-strategy.interface';

import { withLlmRetry } from './utils/with-llm-retry.util';
import { CircuitBreakerService } from '../../infrastructure/resilience/circuit-breaker.service';
import { ToolRepeatGuard } from './guards/tool-repeat-guard';
import { ResponseCriticGate } from './guards/response-critic.gate';
import { InsertAccumulator } from './guards/insert-accumulator';
import { ToolRiskGate } from './guards/tool-risk-gate';
import { ToolCallExecutor } from './tool-call-executor';
import {
  buildMaxStepsAnswer,
  buildQuantityMismatchAnswer,
  buildQuantityNudgePrompt,
} from './utils/react-loop-prompt.util';
import {
  ReactLoopRunDeps,
  ReactLoopRunOptions,
} from './react-loop.interface';

const METADATA_TOOL_REGEX =
  /schema|list_tables|describe|columns|metadata|list_channels|list_spreadsheets|list_repositories/i;

/**
 * Điều khiển vòng lặp ReAct (1 agent, 1 lượt): gọi LLM, chuyển tool call cho
 * ToolCallExecutor, chạy self-check/quantity-nudge khi model dừng gọi tool.
 * Risk-gate (destructive/auto-approve) nằm ở ToolRiskGate, cơ chế thực thi
 * tool (dedup/retry/trace) nằm ở ToolCallExecutor — tách ra để mỗi phần có 1
 * lý do thay đổi riêng, dễ test trực tiếp hơn suy luận qua mock. Xem thiết kế
 * đầy đủ (WHY): docs/orchestration/code-notes/react-loop.service.md
 */
export class ReactLoopRun {
  private readonly dto: RunReactLoopRequestDto;
  private readonly strategy: LlmStrategy;
  private readonly model: string;
  private readonly session: LlmChatSession;
  private readonly signal: AbortSignal;

  private readonly circuitBreaker: CircuitBreakerService;
  private readonly logger: Logger;

  private readonly toolExecutor: ToolCallExecutor;
  private readonly criticGate: ResponseCriticGate;

  constructor(options: ReactLoopRunOptions, deps: ReactLoopRunDeps) {
    this.dto = options.dto;
    this.strategy = options.strategy;
    this.model = options.model;
    this.session = options.session;
    this.signal = options.signal;

    this.circuitBreaker = deps.circuitBreaker;
    this.logger = deps.logger;

    const insertAccumulator = new InsertAccumulator();
    const riskGate = new ToolRiskGate({
      dto: options.dto,
      mcpTools: options.mcpTools,
      strategy: options.strategy,
      model: options.model,
      circuitBreaker: deps.circuitBreaker,
      logger: deps.logger,
      signal: options.signal,
      insertAccumulator,
      preflightGuard: deps.preflightGuard,
      policyEngine: deps.policyEngine,
      semanticPolicyEvaluator: deps.semanticPolicyEvaluator,
      idempotencyManager: deps.idempotencyManager,
      toolToProviderMap: options.toolToProviderMap,
    });
    this.toolExecutor = new ToolCallExecutor(
      {
        dto: options.dto,
        mcpTools: options.mcpTools,
        reactModelId: options.reactModelId,
        signal: options.signal,
        toolToProviderMap: options.toolToProviderMap,
      },
      {
        toolProvider: deps.toolProvider ?? deps.mcpClient,
        mcpClient: deps.toolProvider ?? deps.mcpClient,
        streamSink: deps.streamSink ?? deps.agentStream,
        agentStream: deps.streamSink ?? deps.agentStream,
        memoryManager: deps.memoryManager,
        logger: deps.logger,
        repeatGuard: options.repeatGuard ?? new ToolRepeatGuard(),
        insertAccumulator,
        riskGate,
        actionAudit: deps.actionAudit,
        tmpManager: deps.tmpManager,
        conversationArtifactStore: deps.conversationArtifactStore,
      },
    );

    this.criticGate = new ResponseCriticGate({
      enabled: options.dto.enableCriticReflection ?? false,
      maxSteps: ORCHESTRATION_CONSTANTS.MAX_REACT_STEPS,
      userPrompt: options.dto.prompt,
      sendMessage: (prompt, onToken) => this.sendMessage(prompt, onToken),
      logger: deps.logger,
    });
  }

  async execute(
    onToken: (chunk: string) => void,
    resync: (text: string) => void,
  ): Promise<RunReactLoopResponseDto> {
    let turn = await this.sendMessage(this.dto.prompt, onToken);
    let selfChecked = false;

    for (let step = 0; step < ORCHESTRATION_CONSTANTS.MAX_REACT_STEPS; step++) {
      if (turn.toolCalls.length === 0) {
        const outcome = await this.handleNoMoreToolCalls(
          turn,
          step,
          selfChecked,
          onToken,
          resync,
        );
        if (!outcome.done) {
          selfChecked = true;
          turn = outcome.nextTurn;
          continue;
        }
        return outcome.response;
      }

      resync('');

      const results = await this.toolExecutor.run(turn.toolCalls);

      turn = await this.sendMessage(results, onToken);
    }

    return this.buildMaxStepsResponse(turn);
  }

  /** Model vừa dừng gọi tool — chạy self-check/quantity-nudge (tối đa 1 lần),
   * hoặc chốt câu trả lời nếu đã tự kiểm tra rồi. */
  private async handleNoMoreToolCalls(
    turn: LlmTurnResult,
    step: number,
    selfChecked: boolean,
    onToken: (chunk: string) => void,
    resync: (text: string) => void,
  ): Promise<
    | { done: true; response: RunReactLoopResponseDto }
    | { done: false; nextTurn: LlmTurnResult }
  > {
    const toolCalls = this.toolExecutor.getToolCalls();
    const hasBudget = step < ORCHESTRATION_CONSTANTS.MAX_REACT_STEPS - 1;

    // 1. Dừng sớm nếu không đủ điều kiện Nudge (đã self-check, không có tool calls, hoặc hết ngân sách)
    if (selfChecked || toolCalls.length === 0 || !hasBudget) {
      this.logger.log(`run() done at step=${step} toolCalls=${toolCalls.length}`);
      return {
        done: true,
        response: this.buildResponse(turn.text || DEFAULT_EMPTY_ANSWER),
      };
    }

    // 2. Chặng 1: Nudge số lượng (Quantity Shortfall)
    const quantityResult = await this.evaluateQuantityNudge(turn.text, onToken);
    if (quantityResult?.action === 'continue') {
      return this.continueLoop(quantityResult.nextTurn, resync);
    }
    if (quantityResult?.action === 'mismatch_done') {
      return this.finish(quantityResult.forcedAnswer, resync);
    }

    // 3. Chặng 2: Nudge phản xạ ảo giác số liệu (Critic Fact-Grounding Gate)
    const criticOutcome = await this.criticGate.evaluateOutcome({
      turn,
      step,
      toolCalls,
      selfChecked,
      onToken,
      resync,
    });
    if (criticOutcome) {
      return criticOutcome;
    }

    // 4. Chặng 3: Nudge dữ liệu thật (Metadata Fast-path)
    if (!this.hasRealDataExecution(toolCalls)) {
      const metadataRetryTurn = await this.evaluateMetadataNudge(onToken);
      if (metadataRetryTurn) {
        return this.continueLoop(metadataRetryTurn, resync);
      }
      this.logger.log(
        `run() done at step=${step} toolCalls=${toolCalls.length} (giữ câu trả lời TRƯỚC self-check)`,
      );
    } else {
      this.logger.log(
        `run() done at step=${step} toolCalls=${toolCalls.length} (fast-path: real data fetched, bypassing self-check)`,
      );
    }

    // 5. Toàn bộ chặng kiểm tra thông qua -> Hoàn tất thành công
    return this.finish(turn.text, resync);
  }

  private finish(
    answerText: string | undefined,
    resync: (text: string) => void,
  ): { done: true; response: RunReactLoopResponseDto } {
    const finalAnswer = answerText || DEFAULT_EMPTY_ANSWER;
    resync(finalAnswer);
    return {
      done: true,
      response: this.buildResponse(finalAnswer),
    };
  }

  private continueLoop(
    nextTurn: LlmTurnResult,
    resync: (text: string) => void,
  ): { done: false; nextTurn: LlmTurnResult } {
    resync('');
    return { done: false, nextTurn };
  }

  private buildResponse(answer: string): RunReactLoopResponseDto {
    return {
      answer,
      toolCalls: this.toolExecutor.getToolCalls(),
    };
  }

  private buildMaxStepsResponse(turn: LlmTurnResult): RunReactLoopResponseDto {
    this.logger.warn(
      `run() hit MAX_REACT_STEPS=${ORCHESTRATION_CONSTANTS.MAX_REACT_STEPS} userId=${this.dto.userId}`,
    );
    const answer = buildMaxStepsAnswer(
      turn.text,
      this.toolExecutor.hasAnySuccessfulToolCall(),
    );
    return this.buildResponse(answer);
  }

  private async evaluateQuantityNudge(
    answerBeforeCheck: string,
    onToken: (chunk: string) => void,
  ): Promise<
    | { action: 'continue'; nextTurn: LlmTurnResult }
    | { action: 'mismatch_done'; forcedAnswer: string }
    | undefined
  > {
    const { requiredCount, achievedCount } = await this.checkQuantity();
    if (requiredCount <= 0 || requiredCount === achievedCount) {
      return undefined;
    }

    this.logger.log(
      `quantity mismatch requiredCount=${requiredCount} achievedCount=${achievedCount} — nudging to continue`,
    );
    const nudgeTurn = await this.sendMessage(
      buildQuantityNudgePrompt(requiredCount, achievedCount),
      onToken,
    );
    if (nudgeTurn.toolCalls.length > 0) {
      return { action: 'continue', nextTurn: nudgeTurn };
    }

    this.logger.warn(
      `run() done at step (quantity vẫn thiếu nhưng model không gọi thêm tool) requiredCount=${requiredCount} achievedCount=${achievedCount}`,
    );
    const baseAnswer = answerBeforeCheck || DEFAULT_EMPTY_ANSWER;
    const forcedAnswer = buildQuantityMismatchAnswer(
      baseAnswer,
      requiredCount,
      achievedCount,
    );
    return { action: 'mismatch_done', forcedAnswer };
  }

  private async evaluateMetadataNudge(
    onToken: (chunk: string) => void,
  ): Promise<LlmTurnResult | undefined> {
    this.logger.log('self-check nudge triggered');
    const selfCheckTurn = await this.sendMessage(
      ORCHESTRATION_SELF_CHECK_PROMPT,
      onToken,
    );
    return selfCheckTurn.toolCalls.length > 0 ? selfCheckTurn : undefined;
  }

  // streamedAnything reset lại MỖI lần thử (đầu fn()) — chỉ cho retry khi lần
  // vừa lỗi CHƯA stream ra token nào (xem
  // ORCHESTRATION_CONSTANTS.MAX_LLM_CALL_RETRY_ATTEMPTS).
  private sendMessage(
    input: string | LlmToolResult[],
    onTok?: (chunk: string) => void,
  ): Promise<LlmTurnResult> {
    let streamedAnything = false;
    let trackedOnTok: ((chunk: string) => void) | undefined;
    if (onTok) {
      trackedOnTok = (chunk: string) => {
        streamedAnything = true;
        onTok(chunk);
      };
    }
    return this.circuitBreaker.run(
      `llm:${this.strategy.id}`,
      () =>
        withLlmRetry(
          (attemptSignal) => {
            streamedAnything = false;
            return this.session.sendMessage(input, trackedOnTok, attemptSignal);
          },
          ORCHESTRATION_CONSTANTS.LLM_CALL_TIMEOUT_MS,
          `ReactLoop sendMessage() timeout sau ${ORCHESTRATION_CONSTANTS.LLM_CALL_TIMEOUT_MS / 1000}s (provider=${this.dto.provider}, model=${this.model})`,
          { signal: this.signal, canRetry: () => !streamedAnything },
        ),
      this.signal,
    );
  }

  private hasRealDataExecution(toolCalls: ToolCallTraceDto[]): boolean {
    return toolCalls.some(
      (tc) =>
        tc.status === EStepExecutionStatus.SUCCESS &&
        !METADATA_TOOL_REGEX.test(tc.tool),
    );
  }

  private checkQuantity() {
    return checkQuantityUtil(
      this.dto.prompt,
      this.toolExecutor
        .getToolCalls()
        .map((tc) => `${tc.tool}: ${tc.resultPreview ?? ''}`)
        .join('\n'),
      this.strategy,
      this.model,
      this.circuitBreaker,
      this.logger,
      this.signal,
    );
  }
}
