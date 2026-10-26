import { randomUUID } from 'crypto';
import { Logger } from '@nestjs/common';
import { traceable } from 'langsmith/traceable';
import {
  ORCHESTRATION_CONSTANTS,
  EStepExecutionStatus,
  EAgentStreamStepType,
} from '@agent/core/constants';
import { extractTextFromMcpResult } from '@agent/core/common';
import { IStreamSink, IToolProvider } from '../../contracts';
import {
  RunReactLoopRequestDto,
  ToolCallTraceDto,
} from '../../contracts/dtos/react-loop.dto';
import { LlmToolCall, LlmToolResult } from '../strategy/llm-strategy.interface';

import { ApprovalRequiredError } from './approval-required.error';
import { CallToolResponseDto, McpToolDto } from '../../contracts/dtos/mcp.dto';
import { abortableSleep } from '../../common/abortable-sleep.util';
import { capToolResultSize } from '../../common/token-budget.util';
import { classifyToolError, parseInsertValues } from './tool-execution.util';
import { PiiScrubberUtil } from '../../security/pii/pii-scrubber.util';
import { formatActionSummary } from '../../common/action-summary';
import { MemoryManagerService } from '../../memory/memory-manager.service';
import { ToolRepeatGuard } from './tool-repeat-guard';
import { InsertAccumulator } from './insert-accumulator';
import { ToolRiskGate } from './tool-risk-gate';
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

  private readonly toolCalls: ToolCallTraceDto[] = [];
  private readonly toolToProviderMap?: Map<string, string>;

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
              : `Merged into the SQL batch represented by tool call ${primaryCall.id ?? primarySourceIndex + 1}; no separate database execution and no additional rows were affected.`,
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
      this.dto.provider === 'sql_server' ||
      toolCalls.some((c) => this.resolveToolCall(c.name).provider === 'sql_server');
    if (!hasSqlServer) {
      return toolCalls.map((call, index) => ({ call, sourceIndexes: [index] }));
    }

    const prepared: PreparedToolCall[] = [];
    const batchIndexByTable = new Map<string, number>();

    toolCalls.forEach((call, sourceIndex) => {
      let query: string | undefined;
      const { provider: callProvider, rawName } = this.resolveToolCall(call.name);
      if (
        callProvider === 'sql_server' &&
        rawName === 'execute_write_query' &&
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
      provider !== 'sql_server' ||
      rawName !== 'execute_write_query'
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
      await this.emitToolCall(displayName, argsPreview, toolCallId, friendlySummary);
      await this.recordResult(
        displayName,
        EStepExecutionStatus.ERROR,
        preflightError,
        argsPreview,
        toolCallId,
        friendlySummary,
      );
      return preflightError;
    }

    // 2. Thẩm định chính sách kinh doanh (Declarative Policy Engine / Semantic RAG)
    const policyResult = this.riskGate.evaluatePolicy
      ? await this.riskGate.evaluatePolicy(name, args)
      : null;
    if (policyResult) {
      if (policyResult.status === EPolicyStatus.POLICY_VIOLATION) {
        const violationMsg = `[Chính sách kinh doanh] Từ chối thực thi: ${policyResult.reason}`;
        this.logger.warn(`tool_call ${displayName} vi phạm chính sách: ${policyResult.reason}`);
        await this.emitToolCall(displayName, argsPreview, toolCallId, friendlySummary);
        await this.recordResult(
          displayName,
          EStepExecutionStatus.ERROR,
          violationMsg,
          argsPreview,
          toolCallId,
          friendlySummary,
        );
        return violationMsg;
      }
      if (policyResult.status === EPolicyStatus.EXCEEDS_AI_AUTHORITY) {
        this.logger.warn(
          `tool_call ${displayName} vượt quá thẩm quyền AI, cần escalation: ${policyResult.reason}`,
        );
        throw new EscalationRequiredError(
          policyResult.reason || `Hành động vượt quá thẩm quyền AI`,
          undefined,
          `Thao tác ${displayName} yêu cầu số tiền ${policyResult.currentAmount ?? 'N/A'} vượt hạn mức AI (${policyResult.thresholdLimit ?? 'N/A'})`,
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
      const msg = `[Idempotency] Thao tác đang được xử lý hoặc đã hoàn tất trước đó (${idempotency.reason}).`;
      this.logger.warn(`tool_call ${displayName} bị khóa bởi Idempotency: ${idempotency.reason}`);
      await this.emitToolCall(displayName, argsPreview, toolCallId, friendlySummary);
      await this.recordResult(
        displayName,
        EStepExecutionStatus.ERROR,
        msg,
        argsPreview,
        toolCallId,
        friendlySummary,
      );
      return msg;
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

      if (this.actionAudit) {
        await this.actionAudit.record({
          userId: this.dto.userId,
          tenantId: this.dto.workspaceId,
          actionType: name,
          entityId: String(args.orderId ?? args.id ?? args.order_id ?? ''),
          amount: typeof args.amount === 'number' ? args.amount : undefined,
          evaluationStatus: 'SUCCESS',
          reviewer: 'AI',
          idempotencyKey: idempotency.key,
          metadata: args,
        });
      }

      return result;
    } catch (error) {
      if (this.riskGate.releaseIdempotency && idempotency.key) {
        await this.riskGate.releaseIdempotency(idempotency.key);
      }
      throw error;
    }
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
      await this.emitToolCall(displayName, argsPreview, toolCallId, friendlySummary);
      await this.recordResult(
        displayName,
        EStepExecutionStatus.ERROR,
        shortfallMessage,
        argsPreview,
        toolCallId,
        friendlySummary,
      );
      return shortfallMessage;
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
    const suggestion =
      otherToolNames.length > 0
        ? `KHÔNG được gọi lại tool này. Nếu nhiệm vụ cần 1 HÀNH ĐỘNG (ghi/thêm/tạo/sửa dữ liệu...), hãy gọi tool phù hợp trong số các tool còn lại: ${otherToolNames.join(', ')}.`
        : 'Không còn tool nào khác của hệ thống này để thử.';
    const resultPreview = `Tool "${displayName}" đã được gọi với ĐÚNG tham số này ${attempts - 1} lần trước đó và không thực thi lại nữa. ${suggestion} Nếu không có tool nào phù hợp để hoàn thành yêu cầu, báo thẳng cho người dùng biết giới hạn đó thay vì im lặng bỏ cuộc.`;
    this.logger.warn(
      `tool_call ${displayName} bị chặn — lặp lại quá ${ORCHESTRATION_CONSTANTS.MAX_SAME_TOOL_CALL_REPEATS} lần với cùng tham số`,
    );
    await this.emitToolCall(displayName, argsPreview, toolCallId, friendlySummary);
    await this.recordResult(
      displayName,
      EStepExecutionStatus.ERROR,
      resultPreview,
      argsPreview,
      toolCallId,
      friendlySummary,
    );
    return resultPreview;
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
        if (this.signal?.aborted) {
          throw error;
        }
        const errorMessage = PiiScrubberUtil.scrub(
          (error as Error).message,
        ) as string;
        this.logger.warn(
          `tool_result ${displayName} FAILED (exception): ${errorMessage}`,
        );
        await this.recordResult(
          displayName,
          EStepExecutionStatus.ERROR,
          errorMessage,
          argsPreview,
          toolCallId,
          friendlySummary,
        );
        return capToolResultSize(
          errorMessage,
          this.memoryManager.buildBudget(this.reactModelId)
            .toolResultCharBudget,
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
    } else {
      this.logger.log(`tool_result ${displayName} ok: ${resultPreview}`);
    }

    await this.recordResult(
      displayName,
      status,
      resultPreview,
      argsPreview,
      toolCallId,
      friendlySummary,
    );
    const feedText = capToolResultSize(
      text,
      this.memoryManager.buildBudget(this.reactModelId).toolResultCharBudget,
    );
    if (status === 'success') {
      this.repeatGuard.cacheSuccess(signature, resultPreview, feedText);
    }
    return feedText;
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
