import { Injectable, Logger } from '@nestjs/common';
import { PolicyEvaluationResult } from '../security.interface';
import { BusinessPolicyViolationError } from '../errors/policy-violation.error';
import {
  EActionType,
  EPolicyStatus,
} from '../constants/security.constants';
import {
  ConditionOperator,
  PolicyCondition,
  PolicyConfigFile,
  PolicyRuleDefinition,
} from './policy-rule.interface';
import * as defaultPoliciesJson from './policies.config.json';

export type OrderStatus =
  | 'PENDING'
  | 'PROCESSING'
  | 'SHIPPING'
  | 'DELIVERED'
  | 'CANCELLED'
  | 'REFUNDED';

export interface OrderPolicyContext {
  orderId: string;
  userId: string;
  status: OrderStatus;
  amount: number;
  deliveredAt?: Date | string;
  isSuspiciousCustomer?: boolean;
}

export interface PolicyEvaluationOptions {
  autoApprovalThreshold?: number;
  supervisorThreshold?: number;
  maxRefundDays?: number;
}

/**
 * Động cơ thẩm định chính sách kinh doanh khai báo (Declarative Rule Engine).
 * Loại bỏ hoàn toàn các chuỗi if-else lồng nhau bằng cách nạp và đánh giá các quy tắc
 * từ file cấu hình JSON/YAML (Open/Closed Principle).
 */
@Injectable()
export class BusinessPolicyEngine {
  private readonly logger = new Logger(BusinessPolicyEngine.name);
  private rules: PolicyRuleDefinition[] = [];

  constructor() {
    this.loadRules((defaultPoliciesJson as PolicyConfigFile).rules || []);
  }

  /**
   * Nạp danh sách quy tắc vào pipeline thẩm định.
   */
  loadRules(rules: PolicyRuleDefinition[]): void {
    this.rules = [...rules].sort((a, b) => a.priority - b.priority);
    this.logger.log(`Đã nạp ${this.rules.length} quy tắc chính sách nghiệp vụ.`);
  }

  /**
   * Thẩm tra một hành động dựa trên context và các quy tắc đã nạp.
   */
  evaluate(
    action: EActionType | string,
    context: Record<string, unknown>,
  ): PolicyEvaluationResult {
    const actionRules = this.rules.filter((r) => r.action === action);

    for (const rule of actionRules) {
      const isMatched = this.evaluateCondition(rule.condition, context);
      if (isMatched) {
        this.logger.log(
          `[POLICY MATCH] Action=${action} Rule=${rule.id} (${rule.name}) -> Status=${rule.outcome.status}`,
        );

        const allowed =
          rule.outcome.status === EPolicyStatus.AUTO_APPROVED ||
          rule.outcome.status === EPolicyStatus.USER_CONFIRMATION_REQUIRED;

        return {
          allowed,
          status: rule.outcome.status,
          reason: rule.outcome.reason,
          thresholdLimit: rule.outcome.thresholdLimit,
          currentAmount: typeof context.amount === 'number' ? context.amount : undefined,
        };
      }
    }

    // Fallback mặc định an toàn cho từng loại hành động
    if (action === EActionType.REFUND_ORDER) {
      return {
        allowed: true,
        status: EPolicyStatus.USER_CONFIRMATION_REQUIRED,
        reason: 'Đơn hàng đủ điều kiện hoàn tiền, cần người dùng xác nhận thông tin chuyển khoản.',
        currentAmount: typeof context.amount === 'number' ? context.amount : undefined,
      };
    }

    if (action === EActionType.CANCEL_ORDER) {
      return {
        allowed: true,
        status: EPolicyStatus.AUTO_APPROVED,
        reason: 'Đơn hàng đang chuẩn bị và đủ điều kiện hủy tự động.',
        currentAmount: typeof context.amount === 'number' ? context.amount : undefined,
      };
    }

    return {
      allowed: true,
      status: EPolicyStatus.AUTO_APPROVED,
      reason: 'Hành động được phép thực thi theo chính sách.',
    };
  }

  /**
   * Thẩm định yêu cầu hoàn tiền (Wrapper tương thích ngữ cảnh OrderPolicyContext).
   */
  evaluateRefund(
    context: OrderPolicyContext,
    options?: PolicyEvaluationOptions,
  ): PolicyEvaluationResult {
    const enrichedContext = this.enrichRefundContext(context, options);
    return this.evaluate(EActionType.REFUND_ORDER, enrichedContext);
  }

  /**
   * Thẩm định yêu cầu hủy đơn hàng (Wrapper tương thích ngữ cảnh OrderPolicyContext).
   */
  evaluateCancellation(context: OrderPolicyContext): PolicyEvaluationResult {
    return this.evaluate(EActionType.CANCEL_ORDER, {
      ...context,
    });
  }

  /**
   * Đánh giá điều kiện đơn lẻ của một Rule.
   */
  private evaluateCondition(
    condition: PolicyCondition,
    context: Record<string, unknown>,
  ): boolean {
    const actualValue = context[condition.field];

    return this.compare(condition.operator, actualValue, condition.value);
  }

  /**
   * Toán tử so sánh linh hoạt không dùng if-else lồng phức tạp.
   */
  private compare(
    operator: ConditionOperator,
    actual: unknown,
    expected: unknown,
  ): boolean {
    switch (operator) {
      case 'EQUALS':
        return actual === expected;
      case 'NOT_EQUALS':
        return actual !== expected;
      case 'GREATER_THAN':
        return typeof actual === 'number' && typeof expected === 'number'
          ? actual > expected
          : false;
      case 'GREATER_THAN_OR_EQUAL':
        return typeof actual === 'number' && typeof expected === 'number'
          ? actual >= expected
          : false;
      case 'LESS_THAN':
        return typeof actual === 'number' && typeof expected === 'number'
          ? actual < expected
          : false;
      case 'LESS_THAN_OR_EQUAL':
        return typeof actual === 'number' && typeof expected === 'number'
          ? actual <= expected
          : false;
      case 'IN':
        return Array.isArray(expected) ? expected.includes(actual) : false;
      case 'IS_TRUE':
        return Boolean(actual) === true;
      case 'IS_FALSE':
        return Boolean(actual) === false;
      default:
        return false;
    }
  }

  /**
   * Chuẩn bị các trường tính toán phục vụ thẩm định hoàn tiền (diffDays, amount, status).
   */
  private enrichRefundContext(
    context: OrderPolicyContext,
    options?: PolicyEvaluationOptions,
  ): Record<string, unknown> {
    let diffDays = 0;
    if (context.status === 'DELIVERED' && context.deliveredAt) {
      const deliveredDate = new Date(context.deliveredAt);
      const now = new Date();
      diffDays =
        (now.getTime() - deliveredDate.getTime()) / (1000 * 60 * 60 * 24);
    }

    return {
      ...context,
      diffDays,
      customAutoThreshold: options?.autoApprovalThreshold,
      customSupervisorThreshold: options?.supervisorThreshold,
      customMaxRefundDays: options?.maxRefundDays,
    };
  }

  /**
   * Xác nhận kết quả đánh giá, nếu vi phạm chính sách thì ném exception chuẩn.
   */
  assertPolicy(ruleName: string, result: PolicyEvaluationResult): void {
    if (result.status === EPolicyStatus.POLICY_VIOLATION) {
      throw new BusinessPolicyViolationError(
        ruleName,
        result.reason || 'Vi phạm chính sách kinh doanh',
      );
    }
  }
}
