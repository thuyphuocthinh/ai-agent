import { Logger } from '@nestjs/common';
import { RunReactLoopRequestDto } from '../../../contracts/dtos/react-loop.dto';
import { McpToolDto } from '../../../contracts/dtos/mcp.dto';
import { LlmStrategy } from '../../../contracts/engine/llm-strategy.interface';
import { CircuitBreakerService } from '../../../infrastructure/resilience/circuit-breaker.service';
import { extractRequiredCount } from './quantity-check.util';
import { isLikelyCreateToolCall } from '../../../memory/create-tool-heuristic.util';
import {
  EWriteQueryTargetKind,
  extractWriteQueryPreviewTarget,
} from '../../../common/action-summary/write-query-preview.util';
import { InsertAccumulator } from './insert-accumulator';
import {
  ProviderPreflightGuard,
  BusinessPolicyEngine,
  SemanticPolicyEvaluatorService,
  IdempotencyManager,
  PolicyEvaluationResult,
  PolicyActionStatus,
  EActionType,
  EPolicyStatus,
  EPolicyVerdict,
  EProviderAuthType,
} from '../../../security';

export interface ToolRiskGateOptions {
  dto: RunReactLoopRequestDto;
  mcpTools: McpToolDto[];
  strategy: LlmStrategy;
  model: string;
  circuitBreaker: CircuitBreakerService;
  logger: Logger;
  signal: AbortSignal;
  insertAccumulator: InsertAccumulator;
  preflightGuard?: ProviderPreflightGuard;
  policyEngine?: BusinessPolicyEngine;
  semanticPolicyEvaluator?: SemanticPolicyEvaluatorService;
  idempotencyManager?: IdempotencyManager;
  toolToProviderMap?: Map<string, string>;
}

/**
 * Quyết định risk-gate (destructive? auto-approve INSERT? thiếu dòng so với
 * yêu cầu?) — tách khỏi ReactLoopRun để test được trực tiếp thay vì chỉ suy
 * ra qua số lần gọi mock. KHÔNG tự thực thi tool, chỉ trả quyết định — caller
 * (ToolCallExecutor) mới là nơi chạy tool/ghi trace.
 */
export class ToolRiskGate {
  private readonly dto: RunReactLoopRequestDto;
  private readonly mcpTools: McpToolDto[];
  private readonly strategy: LlmStrategy;
  private readonly model: string;
  private readonly circuitBreaker: CircuitBreakerService;
  private readonly logger: Logger;
  private readonly signal: AbortSignal;
  private readonly insertAccumulator: InsertAccumulator;
  private readonly preflightGuard?: ProviderPreflightGuard;
  private readonly policyEngine?: BusinessPolicyEngine;
  private readonly semanticPolicyEvaluator?: SemanticPolicyEvaluatorService;
  private readonly idempotencyManager?: IdempotencyManager;
  private readonly toolToProviderMap?: Map<string, string>;

  // Lazy + memoized — chỉ tốn 1 LLM call DUY NHẤT cho cả lượt chạy, và chỉ
  // khi thật sự cần (tool ghi dạng create bị chặn approval), không tốn cho
  // các round chỉ đọc dữ liệu.
  private requiredCountPromise: Promise<number> | null = null;

  constructor(options: ToolRiskGateOptions) {
    this.dto = options.dto;
    this.mcpTools = options.mcpTools;
    this.strategy = options.strategy;
    this.model = options.model;
    this.circuitBreaker = options.circuitBreaker;
    this.logger = options.logger;
    this.signal = options.signal;
    this.insertAccumulator = options.insertAccumulator;
    this.preflightGuard = options.preflightGuard;
    this.policyEngine = options.policyEngine;
    this.semanticPolicyEvaluator = options.semanticPolicyEvaluator;
    this.idempotencyManager = options.idempotencyManager;
    this.toolToProviderMap = options.toolToProviderMap;
  }

  private resolveProvider(name: string): string {
    return this.toolToProviderMap?.get(name) ?? this.dto.provider;
  }

  private isInternalReadOnlyTool(name: string): boolean {
    const tool = this.mcpTools.find((t) => t.name === name);
    return (
      tool?.authType === EProviderAuthType.SYSTEM &&
      tool.annotations?.readOnlyHint === true
    );
  }

  isDestructive(name: string): boolean {
    const tool = this.mcpTools.find((t) => t.name === name);
    return Boolean(
      tool?.annotations?.destructiveHint || tool?.isIrreversible,
    );
  }

  async checkPreflight(name: string): Promise<string | null> {
    if (!this.preflightGuard) return null;
    const toolDef = this.mcpTools.find((t) => t.name === name);
    const requiredScopes =
      toolDef?.requiredScopes ?? toolDef?.annotations?.requiredScopes ?? [];
    const authType =
      (toolDef?.authType as EProviderAuthType) ??
      (toolDef?.annotations?.authType as EProviderAuthType) ??
      EProviderAuthType.OAUTH2;

    const check = await this.preflightGuard.check(
      this.dto.userId,
      this.resolveProvider(name),
      requiredScopes,
      authType,
    );
    if (!check.ready) {
      return this.preflightGuard.formatActionableMessage(check);
    }
    return null;
  }

  async evaluatePolicy(
    name: string,
    args: Record<string, unknown>,
  ): Promise<PolicyEvaluationResult | null> {
    // Tool nội bộ chỉ-đọc (VD read_skill: playbook do admin soạn) không chạm dữ liệu
    // nghiệp vụ — để LLM judge đánh giá chỉ gây từ chối nhầm theo ý định của người dùng.
    if (this.isInternalReadOnlyTool(name)) return null;

    // 1. Ưu tiên Semantic Policy Evaluator (Domain-Agnostic Hybrid Gate)
    if (this.semanticPolicyEvaluator) {
      const semantic = await this.semanticPolicyEvaluator.evaluate(
        {
          userId: this.dto.userId,
          provider: this.resolveProvider(name),
          toolName: name,
          args,
          userIntent: this.dto.prompt,
        },
        {
          strategy: this.strategy,
          model: this.model,
          signal: this.signal,
        },
      );

      const status = this.mapVerdictToPolicyStatus(semantic.verdict);
      const allowed =
        semantic.verdict === EPolicyVerdict.ALLOW ||
        semantic.verdict === EPolicyVerdict.REQUIRE_APPROVAL;

      return {
        allowed,
        status,
        reason: semantic.reason,
      };
    }

    // 2. Fallback cho legacy BusinessPolicyEngine nếu có
    if (!this.policyEngine) return null;
    let actionType: string | null = null;
    const lowerName = name.toLowerCase();
    if (lowerName.includes('refund')) {
      actionType = EActionType.REFUND_ORDER;
    } else if (lowerName.includes('cancel')) {
      actionType = EActionType.CANCEL_ORDER;
    }
    if (!actionType) return null;

    return this.policyEngine.evaluate(actionType, {
      ...args,
      userId: this.dto.userId,
    });
  }

  async acquireIdempotency(
    name: string,
    args: Record<string, unknown>,
  ): Promise<{
    success: boolean;
    key?: string;
    reason?: string;
    previousResult?: unknown;
  }> {
    if (!this.idempotencyManager) return { success: true };

    if (this.isReadOnlyTool(name)) {
      return { success: true };
    }

    const res = await this.idempotencyManager.acquireForTool({
      userId: this.dto.userId,
      provider: this.resolveProvider(name),
      toolName: name,
      args,
    });

    return {
      success: res.success,
      key: res.fingerprint,
      reason: res.reason,
      previousResult: res.previousResult,
    };
  }

  async releaseIdempotency(key?: string): Promise<void> {
    if (key && this.idempotencyManager) {
      await this.idempotencyManager.release(key);
    }
  }

  async completeIdempotency(key?: string, result?: unknown): Promise<void> {
    if (key && this.idempotencyManager) {
      await this.idempotencyManager.complete(key, result);
    }
  }

  // INSERT không đụng tới dữ liệu CŨ — sai thì chỉ cần xoá dòng vừa thêm,
  // khác hẳn UPDATE/DELETE (có thể ghi đè/xoá mất dữ liệu không khôi phục
  // được). Chỉ tự chạy đúng trường hợp này, mọi câu lệnh ghi khác vẫn qua
  // Risk Gate như cũ.
  isAutoApprovableInsert(name: string, args: Record<string, unknown>): boolean {
    if (
      this.resolveProvider(name) !== 'sql_server' ||
      name !== 'execute_write_query'
    ) {
      return false;
    }
    const query = typeof args.query === 'string' ? args.query : undefined;
    if (!query) return false;
    return extractWriteQueryPreviewTarget(query)?.kind === EWriteQueryTargetKind.INSERT_ROWS;
  }

  /**
   * Nhận diện tool chỉ đọc dữ liệu (Query / Search / Fetch).
   * Các tool này không làm thay đổi trạng thái hệ thống nên không cần khóa Idempotency.
   */
  private isReadOnlyTool(name: string): boolean {
    const lower = name.toLowerCase();
    const readOnlyPrefixes = [
      'get_',
      'read_',
      'find_',
      'search_',
      'list_',
      'fetch_',
      'check_',
      'describe_',
      'inspect_',
      'query_',
    ];
    return readOnlyPrefixes.some(
      (prefix) => lower.startsWith(prefix) || lower.includes(`.${prefix}`),
    );
  }

  // Model ghi thiếu dòng so với yêu cầu, kể cả rải ra nhiều lần gọi 1-dòng-1-lần —
  // gộp tuple tích luỹ được thành 1 câu INSERT duy nhất, ghi đè args.query.
  async checkBulkInsertShortfall(
    displayName: string,
    argsPreview: string,
    args: Record<string, unknown>,
  ): Promise<string | null> {
    const query = typeof args.query === 'string' ? args.query : undefined;
    if (!query || !isLikelyCreateToolCall({ tool: displayName, argsPreview })) {
      return null;
    }
    const requiredCount = await this.getRequiredCount();
    if (requiredCount <= 0) return null;

    const outcome = this.insertAccumulator.checkShortfall(query, requiredCount);
    if (!outcome) return null;
    if ('mergedQuery' in outcome) {
      args.query = outcome.mergedQuery;
      return null;
    }
    return outcome.shortfallMessage;
  }

  clearAccumulatorFor(query: string): void {
    this.insertAccumulator.clear(query);
  }

  private getRequiredCount(): Promise<number> {
    if (!this.requiredCountPromise) {
      this.requiredCountPromise = extractRequiredCount(
        this.dto.prompt,
        this.strategy,
        this.model,
        this.circuitBreaker,
        this.logger,
        this.signal,
      );
    }
    return this.requiredCountPromise;
  }

  private mapVerdictToPolicyStatus(verdict: EPolicyVerdict): PolicyActionStatus {
    switch (verdict) {
      case EPolicyVerdict.DENY:
        return EPolicyStatus.POLICY_VIOLATION;
      case EPolicyVerdict.ESCALATE:
        return EPolicyStatus.EXCEEDS_AI_AUTHORITY;
      case EPolicyVerdict.REQUIRE_APPROVAL:
        return EPolicyStatus.USER_CONFIRMATION_REQUIRED;
      case EPolicyVerdict.ALLOW:
      default:
        return EPolicyStatus.AUTO_APPROVED;
    }
  }
}
