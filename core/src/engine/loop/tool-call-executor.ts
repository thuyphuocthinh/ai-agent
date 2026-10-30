import { randomUUID } from 'crypto';
import { Logger } from '@nestjs/common';
import { traceable } from 'langsmith/traceable';
import {
  ORCHESTRATION_CONSTANTS,
  EStepExecutionStatus,
  EAgentStreamStepType,
  EXECUTE_WRITE_QUERY_TOOL,
  SQL_SERVER_PROVIDER,
} from '@agent/core/constants';
import { extractTextFromMcpResult } from '@agent/core/common';
import { IStreamSink, IToolProvider } from '../../contracts';
import {
  RunReactLoopRequestDto,
  ToolCallTraceDto,
} from '../../contracts/dtos/react-loop.dto';
import { LlmToolCall, LlmToolResult } from '../../contracts/engine/llm-strategy.interface';

import { ApprovalRequiredError } from './errors/approval-required.error';
import {
  ClarificationRequiredError,
  IClarificationCandidate,
  IArtifactTmpManager,
} from '../../contracts';
import { CallToolResponseDto, McpToolDto } from '../../contracts/dtos/mcp.dto';
import { abortableSleep } from '../../common/async/abortable-sleep.util';
import { capToolResultSize } from '../../common/text/token-budget.util';
import { classifyToolError, parseInsertValues } from './utils/tool-execution.util';
import {
  buildEscalationDetail,
  buildIdempotencyBlockedMessage,
  buildMergedSqlBatchResult,
  buildRepeatedToolCallMessage,
  buildToolExecutionErrorMessage,
} from './utils/react-loop-prompt.util';
import { PiiScrubberUtil } from '../../common/text/pii/pii-scrubber.util';
import { formatActionSummary } from '../../common/action-summary';
import { MemoryManagerService } from '../../memory/memory-manager.service';
import { ToolRepeatGuard } from './guards/tool-repeat-guard';
import { InsertAccumulator } from './guards/insert-accumulator';
import { ToolRiskGate } from './guards/tool-risk-gate';
import { tryOffloadPayloadToDisk } from './utils/tool-payload-offloader.util';
import {
  EPolicyStatus,
  EscalationRequiredError,
  ActionAuditService,
} from '../../security';
import {
  ToolCallExecutorDeps,
  ToolCallExecutorOptions,
} from './tool-executor.interface';

interface PreparedToolCall {
  call: LlmToolCall;
  sourceIndexes: number[];
  insertBatch?: {
    insertPrefix: string;
    tuples: Set<string>;
  };
}

/** Gộp về 1 dòng, không cắt bớt — xem code-notes/react-loop.service.md */
function formatResultPreview(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** Xem code-notes/react-loop.service.md */
function formatArgsPreview(args: Record<string, unknown>): string {
  // Trích xuất ưu tiên để phục vụ syntax highlighting ở Frontend
  if (typeof args.code === 'string') {
    return args.code;
  }
  if (typeof args.query === 'string') {
    return args.query;
  }

  const values = Object.values(args);
  if (values.length === 1 && typeof values[0] === 'string') {
    return values[0];
  }
  return JSON.stringify(args, null, 2);
}

/**
 * Thực thi 1 tool call: hỏi ToolRiskGate xem có cho chạy không (destructive?
 * auto-approve INSERT?), dedup/cache theo ToolRepeatGuard, retry lỗi tạm thời
 * (transient), gọi MCP thật, ghi trace + emit step lên FE. Tách khỏi
 * ReactLoopRun để test được trực tiếp thay vì chỉ suy ra qua số lần gọi mock.
 * Xem thiết kế đầy đủ (WHY): docs/orchestration/code-notes/react-loop.service.md
 */
export class ToolCallExecutor {
  private readonly dto: RunReactLoopRequestDto;
  private readonly mcpTools: McpToolDto[];
  private readonly reactModelId: string;
  private readonly signal: AbortSignal;

  private readonly toolProvider: IToolProvider;
  private readonly streamSink: IStreamSink;
  private readonly memoryManager: MemoryManagerService;
  private readonly logger: Logger;
  private readonly repeatGuard: ToolRepeatGuard;
  private readonly insertAccumulator: InsertAccumulator;
  private readonly riskGate: ToolRiskGate;
  private readonly actionAudit?: ActionAuditService;
  private readonly tmpManager?: IArtifactTmpManager;

  private readonly toolCalls: ToolCallTraceDto[] = [];
  private readonly toolToProviderMap?: Map<string, string>;
  private readonly consecutiveFailuresByTool = new Map<string, number>();

  // handleToolCall() bind + traceable() 1 LẦN ở constructor — gọi trực tiếp
  // this.handleToolCall(...) trong run() sẽ KHÔNG lên trace LangSmith.
  private readonly tracedHandleToolCall: (
    name: string,
    args: Record<string, unknown>,
  ) => Promise<string>;

  constructor(options: ToolCallExecutorOptions, deps: ToolCallExecutorDeps) {
    this.dto = options.dto;
    this.mcpTools = options.mcpTools;
    this.reactModelId = options.reactModelId;
    this.signal = options.signal;
    this.toolToProviderMap = options.toolToProviderMap;

    this.toolProvider = (deps.toolProvider ?? deps.mcpClient)!;
    this.streamSink = (deps.streamSink ?? deps.agentStream)!;
    this.memoryManager = deps.memoryManager;
    this.logger = deps.logger;
    this.repeatGuard = deps.repeatGuard;
    this.insertAccumulator = deps.insertAccumulator;
    this.riskGate = deps.riskGate;
    this.actionAudit = deps.actionAudit;
    this.tmpManager = deps.tmpManager;

    this.tracedHandleToolCall = traceable(
      (name: string, args: Record<string, unknown>) =>
        this.handleToolCall(name, args),
      { name: 'mcp.callTool' },
    );
  }

  getToolCalls(): ToolCallTraceDto[] {
    return this.toolCalls;
  }

  hasAnySuccessfulToolCall(): boolean {
    return this.toolCalls.some((tc) => tc.status === 'success');
  }

  private resolveToolCall(name: string): { provider: string; rawName: string } {
    const provider = this.toolToProviderMap?.get(name) ?? this.dto.provider;
    let rawName = name;
    if (name.startsWith(`${provider}__`)) {
      rawName = name.slice(provider.length + 2);
    }
    return { provider, rawName };
  }

  async run(toolCalls: LlmToolCall[]): Promise<LlmToolResult[]> {
    const preparedCalls = this.prepareToolCalls(toolCalls);
    const lastRunBySignature = new Map<string, Promise<unknown>>();
    const lastRunByTable = new Map<string, Promise<unknown>>();

    const runs = preparedCalls.map(({ call }) => {
      const signature = `${call.name}:${JSON.stringify(call.args)}`;
      const tableKey = this.resolveInsertTableKey(call);
      const waitFor = [
        lastRunBySignature.get(signature),
        tableKey ? lastRunByTable.get(tableKey) : undefined,
      ].filter((p): p is Promise<unknown> => !!p);

      let run: Promise<string>;
      if (waitFor.length > 0) {
        run = Promise.allSettled(waitFor).then(() =>
          this.tracedHandleToolCall(call.name, call.args),
        );
      } else {
        run = this.tracedHandleToolCall(call.name, call.args);
      }

      lastRunBySignature.set(signature, run);
      if (tableKey) lastRunByTable.set(tableKey, run);
      return run;
    });

    const preparedResults = await Promise.all(runs);
    const resultsBySourceIndex = new Map<number, LlmToolResult>();

    preparedCalls.forEach((prepared, preparedIndex) => {
      const primarySourceIndex = prepared.sourceIndexes[0];
      const primaryCall = toolCalls[primarySourceIndex];
      const content = preparedResults[preparedIndex] as string;

      prepared.sourceIndexes.forEach((sourceIndex, indexInBatch) => {
        const sourceCall = toolCalls[sourceIndex];
        resultsBySourceIndex.set(sourceIndex, {
          id: sourceCall.id,
          name: sourceCall.name,
          content:
            indexInBatch === 0
              ? content
              : buildMergedSqlBatchResult(
                  primaryCall.id ?? primarySourceIndex + 1,
                ),
        });
      });
    });

    return toolCalls.map(
      (call, index) =>
        resultsBySourceIndex.get(index) ?? {
          id: call.id,
          name: call.name,
          content: 'Tool call result was not produced.',
        },
    );
  }

  private prepareToolCalls(toolCalls: LlmToolCall[]): PreparedToolCall[] {
    const hasSqlServer =
      this.dto.provider === SQL_SERVER_PROVIDER ||
      toolCalls.some((c) => this.resolveToolCall(c.name).provider === SQL_SERVER_PROVIDER);
    if (!hasSqlServer) {
      return toolCalls.map((call, index) => ({ call, sourceIndexes: [index] }));
    }

    const prepared: PreparedToolCall[] = [];
    const batchIndexByTable = new Map<string, number>();

    toolCalls.forEach((call, sourceIndex) => {
      let query: string | undefined;
      const { provider: callProvider, rawName } = this.resolveToolCall(call.name);
      if (
        callProvider === SQL_SERVER_PROVIDER &&
        rawName === EXECUTE_WRITE_QUERY_TOOL &&
        typeof call.args.query === 'string'
      ) {
        query = call.args.query;
      }
      const parsed = query ? parseInsertValues(query) : null;

      if (!parsed) {
        prepared.push({ call, sourceIndexes: [sourceIndex] });
        return;
      }

      const existingIndex = batchIndexByTable.get(parsed.tableSignature);
      if (existingIndex === undefined) {
        batchIndexByTable.set(parsed.tableSignature, prepared.length);
        prepared.push({
          call: { ...call, args: { ...call.args } },
          sourceIndexes: [sourceIndex],
          insertBatch: {
            insertPrefix: parsed.insertPrefix,
            tuples: new Set(parsed.tuples),
          },
        });
        return;
      }

      const existing = prepared[existingIndex];
      existing.sourceIndexes.push(sourceIndex);
      parsed.tuples.forEach((tuple) => existing.insertBatch!.tuples.add(tuple));
    });

    prepared.forEach((entry) => {
      if (!entry.insertBatch || entry.sourceIndexes.length === 1) return;
      entry.call.args.query = `${entry.insertBatch.insertPrefix} ${Array.from(entry.insertBatch.tuples).join(', ')}`;
    });

    return prepared;
  }

  private resolveInsertTableKey(call: LlmToolCall): string | null {
    const { provider, rawName } = this.resolveToolCall(call.name);
    if (
      provider !== SQL_SERVER_PROVIDER ||
      rawName !== EXECUTE_WRITE_QUERY_TOOL
    ) {
      return null;
    }
    const query =
      typeof call.args.query === 'string' ? call.args.query : undefined;
    if (!query) return null;
    return this.insertAccumulator.tableKeyFor(query);
  }

  private async handleToolCall(
    name: string,
    args: Record<string, unknown>,
  ): Promise<string> {
    const { provider, rawName } = this.resolveToolCall(name);
    const displayName = `${provider}.${rawName}`;
    const argsPreview = formatArgsPreview(args);
    // 1 id cho MỖI lời gọi tool của model — gắn vào cả tool_call lẫn tool_result
    // để client ghép đúng cặp khi cùng 1 tool bị gọi nhiều lần trong 1 turn.
    const toolCallId = `call_${randomUUID()}`;
    const toolDef = this.mcpTools.find((t) => t.name === name);
    const friendlySummary = formatActionSummary({
      provider,
      toolName: rawName,
      args,
      toolDescription: toolDef?.description,
    });

    // 1. Preflight check: kiểm tra quyền kết nối & OAuth Scopes
    const preflightError = this.riskGate.checkPreflight
      ? await this.riskGate.checkPreflight(name)
      : null;
    if (preflightError) {
      this.logger.warn(
        `tool_call ${displayName} bị từ chối bởi Preflight Guard: ${preflightError}`,
      );
      return this.rejectCall(
        displayName,
        argsPreview,
        toolCallId,
        friendlySummary,
        preflightError,
      );
    }

    // 2. Thẩm định chính sách kinh doanh (Declarative Policy Engine / Semantic RAG)
    const policyRejection = await this.applyPolicy(
      name,
      args,
      displayName,
      argsPreview,
      toolCallId,
      friendlySummary,
    );
    if (policyRejection !== undefined) return policyRejection;

    if (this.riskGate.isDestructive(name)) {
      return this.handleDestructiveToolCall(
        name,
        args,
        displayName,
        argsPreview,
        toolCallId,
        friendlySummary,
      );
    }

    return this.executeTrackedToolCall(
      name,
      args,
      displayName,
      argsPreview,
      toolCallId,
      friendlySummary,
    );
  }

  // Thẩm định chính sách kinh doanh: trả thông báo từ chối nếu vi phạm, ném lỗi escalation/
  // approval nếu cần; undefined nghĩa là được đi tiếp.
  private async applyPolicy(
    name: string,
    args: Record<string, unknown>,
    displayName: string,
    argsPreview: string,
    toolCallId: string,
    friendlySummary?: string,
  ): Promise<string | undefined> {
    const { provider, rawName } = this.resolveToolCall(name);
    const policyResult = this.riskGate.evaluatePolicy
      ? await this.riskGate.evaluatePolicy(name, args)
      : null;
    if (policyResult) {
      if (policyResult.status === EPolicyStatus.POLICY_VIOLATION) {
        const violationMsg = `[Chính sách kinh doanh] Từ chối thực thi: ${policyResult.reason}`;
        this.logger.warn(`tool_call ${displayName} vi phạm chính sách: ${policyResult.reason}`);
        return this.rejectCall(
          displayName,
          argsPreview,
          toolCallId,
          friendlySummary,
          violationMsg,
        );
      }
      if (policyResult.status === EPolicyStatus.EXCEEDS_AI_AUTHORITY) {
        this.logger.warn(
          `tool_call ${displayName} vượt quá thẩm quyền AI, cần escalation: ${policyResult.reason}`,
        );
        throw new EscalationRequiredError(
          policyResult.reason || `Hành động vượt quá thẩm quyền AI`,
          undefined,
          buildEscalationDetail(
            displayName,
            policyResult.currentAmount,
            policyResult.thresholdLimit,
          ),
          policyResult.currentAmount,
        );
      }
      if (policyResult.status === EPolicyStatus.USER_CONFIRMATION_REQUIRED) {
        this.logger.log(
          `tool_call ${displayName} cần người dùng xác nhận theo chính sách`,
        );
        throw new ApprovalRequiredError(
          { provider, name: rawName, args },
          this.toolCalls,
        );
      }
    }
    return undefined;
  }

  private async executeTrackedToolCall(
    name: string,
    args: Record<string, unknown>,
    displayName: string,
    argsPreview: string,
    toolCallId: string,
    friendlySummary?: string,
  ): Promise<string> {
    const signature = `${name}:${JSON.stringify(args)}`;
    const attempts = this.repeatGuard.recordAttempt(signature);

    if (attempts > 1) {
      const cached = this.repeatGuard.getCachedSuccess(signature);
      if (cached) {
        return this.reuseCachedCall(
          displayName,
          argsPreview,
          attempts,
          cached,
          toolCallId,
          friendlySummary,
        );
      }
    }

    if (attempts > ORCHESTRATION_CONSTANTS.MAX_SAME_TOOL_CALL_REPEATS) {
      return this.blockRepeatedCall(
        name,
        displayName,
        argsPreview,
        attempts,
        toolCallId,
        friendlySummary,
      );
    }

    const idempotency = this.riskGate.acquireIdempotency
      ? await this.riskGate.acquireIdempotency(name, args)
      : { success: true, key: '' };
    if (!idempotency.success) {
      const msg = buildIdempotencyBlockedMessage(idempotency.reason);
      this.logger.warn(`tool_call ${displayName} bị khóa bởi Idempotency: ${idempotency.reason}`);
      return this.rejectCall(
        displayName,
        argsPreview,
        toolCallId,
        friendlySummary,
        msg,
      );
    }

    try {
      const result = await this.runToolCall(
        name,
        args,
        displayName,
        argsPreview,
        signature,
        toolCallId,
        friendlySummary,
      );
      if (this.riskGate.completeIdempotency && idempotency.key) {
        await this.riskGate.completeIdempotency(idempotency.key, result);
      }

      await this.auditSuccess(name, args, idempotency.key);

      return result;
    } catch (error) {
      if (this.riskGate.releaseIdempotency && idempotency.key) {
        await this.riskGate.releaseIdempotency(idempotency.key);
      }
      throw error;
    }
  }

  private async auditSuccess(
    name: string,
    args: Record<string, unknown>,
    idempotencyKey: string | undefined,
  ): Promise<void> {
    if (!this.actionAudit) return;
    await this.actionAudit.record({
      userId: this.dto.userId,
      tenantId: this.dto.workspaceId,
      actionType: name,
      entityId: String(args.orderId ?? args.id ?? args.order_id ?? ''),
      amount: typeof args.amount === 'number' ? args.amount : undefined,
      evaluationStatus: 'SUCCESS',
      reviewer: 'AI',
      idempotencyKey,
      metadata: args,
    });
  }

  /** Risk Gate (Giai đoạn 3, HITL) — chặn TRƯỚC KHI thực thi, trừ khi model
   * ghi thiếu dòng so với yêu cầu (nhắc sửa lại thay vì đẩy lên duyệt ngay). */
  private async handleDestructiveToolCall(
    name: string,
    args: Record<string, unknown>,
    displayName: string,
    argsPreview: string,
    toolCallId: string,
    friendlySummary?: string,
  ): Promise<string> {
    const shortfallMessage = await this.riskGate.checkBulkInsertShortfall(
      displayName,
      argsPreview,
      args,
    );
    if (shortfallMessage) {
      this.logger.warn(
        `tool_call ${displayName} bị chặn TRƯỚC approval: ${shortfallMessage}`,
      );
      return this.rejectCall(
        displayName,
        argsPreview,
        toolCallId,
        friendlySummary,
        shortfallMessage,
      );
    }

    if (this.riskGate.isAutoApprovableInsert(name, args)) {
      this.logger.log(
        `tool_call ${displayName} tự chạy — INSERT rủi ro thấp (không đụng dữ liệu cũ), bỏ qua bước duyệt`,
      );
      const result = await this.executeTrackedToolCall(
        name,
        args,
        displayName,
        argsPreview,
        toolCallId,
        friendlySummary,
      );
      this.riskGate.clearAccumulatorFor(args.query as string);
      return result;
    }

    const { provider, rawName } = this.resolveToolCall(name);
    this.logger.log(
      `tool_call ${displayName} requires approval — blocked before execution`,
    );
    throw new ApprovalRequiredError(
      { provider, name: rawName, args },
      this.toolCalls,
    );
  }

  private async reuseCachedCall(
    displayName: string,
    argsPreview: string,
    attempts: number,
    cached: { resultPreview: string; feedText: string },
    toolCallId: string,
    friendlySummary?: string,
  ): Promise<string> {
    this.logger.log(
      `tool_call ${displayName} lặp lại lần ${attempts}, ĐÚNG tham số đã thành công trước đó — dùng lại kết quả cũ, không gọi tool thật lần nữa`,
    );
    await this.emitToolCall(displayName, argsPreview, toolCallId, friendlySummary);
    await this.recordResult(
      displayName,
      EStepExecutionStatus.SUCCESS,
      cached.resultPreview,
      argsPreview,
      toolCallId,
      friendlySummary,
    );
    return cached.feedText;
  }

  private async blockRepeatedCall(
    name: string,
    displayName: string,
    argsPreview: string,
    attempts: number,
    toolCallId: string,
    friendlySummary?: string,
  ): Promise<string> {
    const otherToolNames = this.mcpTools
      .map((t) => t.name)
      .filter((n) => n !== name);
    const resultPreview = buildRepeatedToolCallMessage(
      displayName,
      attempts,
      otherToolNames,
    );
    this.logger.warn(
      `tool_call ${displayName} bị chặn — lặp lại quá ${ORCHESTRATION_CONSTANTS.MAX_SAME_TOOL_CALL_REPEATS} lần với cùng tham số`,
    );
    return this.rejectCall(
      displayName,
      argsPreview,
      toolCallId,
      friendlySummary,
      resultPreview,
    );
  }

  private async runToolCall(
    name: string,
    args: Record<string, unknown>,
    displayName: string,
    argsPreview: string,
    signature: string,
    toolCallId: string,
    friendlySummary?: string,
  ): Promise<string> {
    this.logger.log(`tool_call ${displayName} args=${JSON.stringify(args)}`);
    await this.emitToolCall(displayName, argsPreview, toolCallId, friendlySummary);

    let result: CallToolResponseDto;
    let text: string;
    let status: EStepExecutionStatus;
    let resultPreview: string;
    let transientAttempt = 0;

    while (true) {
      transientAttempt++;
      try {
        const { provider, rawName } = this.resolveToolCall(name);
        result = await this.toolProvider.callTool(
          {
            provider,
            name: rawName,
            args,
            ownerId: this.dto.userId,
            workspaceId: this.dto.workspaceId,
          },
          this.signal,
        );
      } catch (error) {
        return this.handleCallFailure(
          error,
          displayName,
          argsPreview,
          toolCallId,
          friendlySummary,
        );
      }

      text = extractTextFromMcpResult(result);
      status = result.isError
        ? EStepExecutionStatus.ERROR
        : EStepExecutionStatus.SUCCESS;
      resultPreview = formatResultPreview(text);

      const shouldRetryTransiently =
        status === EStepExecutionStatus.ERROR &&
        transientAttempt <
        ORCHESTRATION_CONSTANTS.MAX_TRANSIENT_TOOL_RETRY_ATTEMPTS &&
        classifyToolError(resultPreview) === 'retryable';
      if (!shouldRetryTransiently) break;

      this.logger.warn(
        `tool_result ${displayName} lỗi tạm thời (retryable) — tự thử lại lần ${transientAttempt + 1}/${ORCHESTRATION_CONSTANTS.MAX_TRANSIENT_TOOL_RETRY_ATTEMPTS}, ẩn với LLM: ${resultPreview}`,
      );
      await abortableSleep(
        ORCHESTRATION_CONSTANTS.TRANSIENT_RETRY_BACKOFF_MS,
        this.signal,
      );
    }

    if (status === 'error') {
      this.logger.warn(`tool_result ${displayName} FAILED: ${resultPreview}`);
      text = this.formatToolFailureMessage(name, displayName, text);
    } else {
      this.logger.log(`tool_result ${displayName} ok: ${resultPreview}`);
      this.consecutiveFailuresByTool.delete(name);
    }

    await this.recordResult(
      displayName,
      status,
      resultPreview,
      argsPreview,
      toolCallId,
      friendlySummary,
    );
    const feedText = await this.prepareFeedText(name, text, status);
    if (status === 'success') {
      this.repeatGuard.cacheSuccess(signature, resultPreview, feedText);
    }
    return feedText;
  }

  // Định dạng thông báo lỗi tool kèm gợi ý tự sửa lỗi hoặc lệnh dừng khẩn cấp (Fail-Fast)
  private formatToolFailureMessage(
    name: string,
    displayName: string,
    rawErrorText: string,
  ): string {
    const failures = (this.consecutiveFailuresByTool.get(name) ?? 0) + 1;
    this.consecutiveFailuresByTool.set(name, failures);

    const maxRetries =
      this.dto.maxSelfCorrectionRetries ??
      ORCHESTRATION_CONSTANTS.MAX_SELF_CORRECTION_RETRIES;
    const isFailFast = failures >= maxRetries;
    return buildToolExecutionErrorMessage(
      rawErrorText,
      displayName,
      isFailFast,
      failures,
    );
  }

  // Tool ném exception: huỷ/hỏi-lại thì ném tiếp; còn lại ghi tool_result ERROR (đã scrub PII)
  // và trả thông báo lỗi (đã cắt theo ngân sách) cho LLM.
  private async handleCallFailure(
    error: unknown,
    displayName: string,
    argsPreview: string,
    toolCallId: string,
    friendlySummary?: string,
  ): Promise<string> {
    if (this.signal?.aborted) {
      throw error;
    }
    this.rethrowIfClarification(error);
    const errorMessage = PiiScrubberUtil.scrub(
      (error as Error).message,
    ) as string;
    this.logger.warn(
      `tool_result ${displayName} FAILED (exception): ${errorMessage}`,
    );
    const formattedError = this.formatToolFailureMessage(
      displayName,
      displayName,
      errorMessage,
    );
    await this.recordResult(
      displayName,
      EStepExecutionStatus.ERROR,
      errorMessage,
      argsPreview,
      toolCallId,
      friendlySummary,
    );
    return this.capForFeed(formattedError);
  }

  // Tool call bị từ chối trước khi gọi thật (preflight/policy/idempotency/lặp/thiếu dòng):
  // emit tool_call + ghi tool_result ERROR, rồi trả chính thông báo đó cho LLM.
  private async rejectCall(
    displayName: string,
    argsPreview: string,
    toolCallId: string,
    friendlySummary: string | undefined,
    message: string,
  ): Promise<string> {
    await this.emitToolCall(displayName, argsPreview, toolCallId, friendlySummary);
    await this.recordResult(
      displayName,
      EStepExecutionStatus.ERROR,
      message,
      argsPreview,
      toolCallId,
      friendlySummary,
    );
    return message;
  }

  // Lỗi hỏi lại người dùng (kể cả bản sao khác module, nhận diện qua name) được ném lại
  // kèm toolCalls đã ghi; lỗi khác thì bỏ qua để nơi gọi xử lý như lỗi tool thường.
  private rethrowIfClarification(error: unknown): void {
    if (
      error instanceof ClarificationRequiredError ||
      (error as Error)?.name === 'ClarificationRequiredError'
    ) {
      if (error instanceof ClarificationRequiredError) {
        throw error;
      }
      const e = error as Error & { candidates?: IClarificationCandidate[]; parameterName?: string };
      throw new ClarificationRequiredError(
        e.message,
        e.candidates ?? [],
        this.toolCalls,
        e.parameterName,
      );
    }
  }

  // Chuẩn bị nội dung trả về cho LLM: Tự động lưu ra đĩa nếu vượt ngưỡng 50KB, hoặc cắt gọt theo token budget
  private async prepareFeedText(
    name: string,
    text: string,
    status: EStepExecutionStatus,
  ): Promise<string> {
    if (status === EStepExecutionStatus.SUCCESS) {
      const turnId = this.dto.messageId || 'turn-default';
      const offloaded = await tryOffloadPayloadToDisk(
        name,
        text,
        turnId,
        this.tmpManager,
      );
      if (offloaded) return offloaded;
    }
    return this.capForFeed(text);
  }

  // Cắt kết quả tool theo ngân sách ký tự của model trước khi đưa lại cho LLM.
  private capForFeed(text: string): string {
    return capToolResultSize(
      text,
      this.memoryManager.buildBudget(this.reactModelId).toolResultCharBudget,
    );
  }

  // Mọi tool_result (kể cả bị chặn/dùng lại cache) đều phải có tool_call đi trước,
  // để client biết input của lời gọi thay vì phải tự bịa.
  private emitToolCall(
    displayName: string,
    argsPreview: string,
    toolCallId: string,
    friendlySummary?: string,
  ): Promise<void> {
    return this.emitStep({
      type: EAgentStreamStepType.TOOL_CALL,
      tool: displayName,
      argsPreview,
      toolCallId,
      friendlySummary,
    });
  }

  private async recordResult(
    tool: string,
    status: EStepExecutionStatus,
    resultPreview: string,
    argsPreview?: string,
    toolCallId?: string,
    friendlySummary?: string,
  ): Promise<void> {
    await this.emitStep({
      type: EAgentStreamStepType.TOOL_RESULT,
      tool,
      status,
      resultPreview,
      toolCallId,
      friendlySummary,
    });
    this.toolCalls.push({ tool, status, resultPreview, argsPreview });
  }

  private emitStep(step: {
    type: EAgentStreamStepType.TOOL_CALL | EAgentStreamStepType.TOOL_RESULT;
    tool: string;
    status?: EStepExecutionStatus;
    resultPreview?: string;
    argsPreview?: string;
    toolCallId?: string;
    friendlySummary?: string;
  }): Promise<void> {
    return this.streamSink.emitStep(
      {
        userId: this.dto.userId,
        channelId: this.dto.channelId,
        messageId: this.dto.messageId,
        channelType: this.dto.channelType,
        streamKey: this.dto.streamKey,
      },
      step,
    );
  }
}
