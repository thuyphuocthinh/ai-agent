import { BusinessPolicyEngine, OrderPolicyContext } from './business-policy.engine';
import { EPolicyStatus, EActionType } from '../constants/security.constants';
import { BusinessPolicyViolationError } from '../errors/policy-violation.error';

describe('BusinessPolicyEngine (Declarative Rule Engine)', () => {
  let engine: BusinessPolicyEngine;

  beforeEach(() => {
    engine = new BusinessPolicyEngine();
  });

  describe('Refund Policy Evaluation', () => {
    it('blocks refund if order was already refunded (RULE_REFUND_ALREADY_PROCESSED)', () => {
      const context: OrderPolicyContext = {
        orderId: '101',
        userId: 'u1',
        status: 'REFUNDED',
        amount: 150_000,
      };

      const result = engine.evaluateRefund(context);
      expect(result.allowed).toBe(false);
      expect(result.status).toBe(EPolicyStatus.POLICY_VIOLATION);
      expect(result.reason).toContain('đã được hoàn tiền');
    });

    it('blocks refund if delivery exceeded 7 days (RULE_REFUND_EXPIRED_WINDOW)', () => {
      const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
      const context: OrderPolicyContext = {
        orderId: '102',
        userId: 'u1',
        status: 'DELIVERED',
        amount: 300_000,
        deliveredAt: tenDaysAgo,
      };

      const result = engine.evaluateRefund(context);
      expect(result.allowed).toBe(false);
      expect(result.status).toBe(EPolicyStatus.POLICY_VIOLATION);
      expect(result.reason).toContain('quá 7 ngày');
    });

    it('escalates to human if customer is marked suspicious (RULE_REFUND_SUSPICIOUS_CUSTOMER)', () => {
      const context: OrderPolicyContext = {
        orderId: '103',
        userId: 'u_fraud',
        status: 'DELIVERED',
        amount: 100_000,
        deliveredAt: new Date(),
        isSuspiciousCustomer: true,
      };

      const result = engine.evaluateRefund(context);
      expect(result.allowed).toBe(false);
      expect(result.status).toBe(EPolicyStatus.EXCEEDS_AI_AUTHORITY);
      expect(result.reason).toContain('giám sát rủi ro');
    });

    it('escalates to supervisor if refund amount exceeds AI limit > 2,000,000 VND (RULE_REFUND_EXCEEDS_AI_AUTHORITY)', () => {
      const context: OrderPolicyContext = {
        orderId: '104',
        userId: 'u1',
        status: 'DELIVERED',
        amount: 3_500_000,
        deliveredAt: new Date(),
      };

      const result = engine.evaluateRefund(context);
      expect(result.allowed).toBe(false);
      expect(result.status).toBe(EPolicyStatus.EXCEEDS_AI_AUTHORITY);
      expect(result.thresholdLimit).toBe(2_000_000);
      expect(result.reason).toContain('vượt quá hạn mức');
    });

    it('auto-approves small refunds <= 200,000 VND (RULE_REFUND_AUTO_APPROVED)', () => {
      const context: OrderPolicyContext = {
        orderId: '105',
        userId: 'u1',
        status: 'DELIVERED',
        amount: 150_000,
        deliveredAt: new Date(),
      };

      const result = engine.evaluateRefund(context);
      expect(result.allowed).toBe(true);
      expect(result.status).toBe(EPolicyStatus.AUTO_APPROVED);
      expect(result.thresholdLimit).toBe(200_000);
    });

    it('requires user confirmation for valid orders within authority limit (200k - 2M)', () => {
      const context: OrderPolicyContext = {
        orderId: '106',
        userId: 'u1',
        status: 'DELIVERED',
        amount: 699_000,
        deliveredAt: new Date(),
      };

      const result = engine.evaluateRefund(context);
      expect(result.allowed).toBe(true);
      expect(result.status).toBe(EPolicyStatus.USER_CONFIRMATION_REQUIRED);
    });
  });

  describe('Cancellation Policy Evaluation', () => {
    it('blocks cancellation if order is currently SHIPPING', () => {
      const context: OrderPolicyContext = {
        orderId: '201',
        userId: 'u1',
        status: 'SHIPPING',
        amount: 500_000,
      };

      const result = engine.evaluateCancellation(context);
      expect(result.allowed).toBe(false);
      expect(result.status).toBe(EPolicyStatus.POLICY_VIOLATION);
      expect(result.reason).toContain('vận chuyển');
    });

    it('blocks cancellation if order was DELIVERED', () => {
      const context: OrderPolicyContext = {
        orderId: '202',
        userId: 'u1',
        status: 'DELIVERED',
        amount: 500_000,
      };

      const result = engine.evaluateCancellation(context);
      expect(result.allowed).toBe(false);
      expect(result.status).toBe(EPolicyStatus.POLICY_VIOLATION);
      expect(result.reason).toContain('đã được giao thành công');
    });

    it('blocks cancellation if order was already CANCELLED', () => {
      const context: OrderPolicyContext = {
        orderId: '203',
        userId: 'u1',
        status: 'CANCELLED',
        amount: 500_000,
      };

      const result = engine.evaluateCancellation(context);
      expect(result.allowed).toBe(false);
      expect(result.status).toBe(EPolicyStatus.POLICY_VIOLATION);
    });

    it('auto-approves cancellation for PENDING order', () => {
      const context: OrderPolicyContext = {
        orderId: '204',
        userId: 'u1',
        status: 'PENDING',
        amount: 699_000,
      };

      const result = engine.evaluateCancellation(context);
      expect(result.allowed).toBe(true);
      expect(result.status).toBe(EPolicyStatus.AUTO_APPROVED);
    });
  });

  describe('Dynamic Policy Extension without code changes', () => {
    it('evaluates a dynamically added policy rule at runtime', () => {
      // Giả lập thêm 1 quy tắc mới từ JSON mà không sửa code engine:
      // "Khách hàng VIP không bao giờ bị chặn hoàn tiền"
      engine.loadRules([
        {
          id: 'RULE_VIP_BYPASS',
          name: 'Khách VIP được đặc cách duyệt tự động',
          action: EActionType.REFUND_ORDER,
          priority: 1, // ưu tiên cao nhất
          condition: {
            field: 'isVip',
            operator: 'IS_TRUE',
          },
          outcome: {
            status: EPolicyStatus.AUTO_APPROVED,
            reason: 'Khách hàng VIP được hoàn tiền tự động.',
          },
        },
      ]);

      const result = engine.evaluate(EActionType.REFUND_ORDER, {
        orderId: 'vip_1',
        isVip: true,
        amount: 10_000_000,
      });

      expect(result.allowed).toBe(true);
      expect(result.status).toBe(EPolicyStatus.AUTO_APPROVED);
      expect(result.reason).toContain('Khách hàng VIP');
    });
  });

  describe('assertPolicy', () => {
    it('throws BusinessPolicyViolationError when policy is violated', () => {
      expect(() => {
        engine.assertPolicy('REFUND_RULE', {
          allowed: false,
          status: EPolicyStatus.POLICY_VIOLATION,
          reason: 'Đơn hàng quá hạn 7 ngày',
        });
      }).toThrow(BusinessPolicyViolationError);
    });

    it('does not throw when policy is allowed', () => {
      expect(() => {
        engine.assertPolicy('REFUND_RULE', {
          allowed: true,
          status: EPolicyStatus.AUTO_APPROVED,
        });
      }).not.toThrow();
    });
  });
});
