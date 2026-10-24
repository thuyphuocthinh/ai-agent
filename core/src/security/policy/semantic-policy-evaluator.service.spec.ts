import { SemanticPolicyEvaluatorService } from './semantic-policy-evaluator.service';
import { PolicyCorpusService } from './policy-corpus.service';
import {
  EPolicyVerdict,
  EOrderStatus,
} from '../constants/security.constants';
import type { LlmStrategy } from '../../engine/strategy/llm-strategy.interface';

describe('SemanticPolicyEvaluatorService', () => {
  let evaluator: SemanticPolicyEvaluatorService;
  let corpus: PolicyCorpusService;

  beforeEach(() => {
    corpus = new PolicyCorpusService();
    evaluator = new SemanticPolicyEvaluatorService(corpus);
  });

  describe('DevOps Domain Guardrails', () => {
    it('DENIES destructive DROP TABLE operations citing SEC-DEVOPS-001', async () => {
      const result = await evaluator.evaluate({
        userId: 'dev-01',
        provider: 'sql_server',
        toolName: 'execute_write_query',
        args: {
          query: 'DROP TABLE customers;',
        },
        userIntent: 'Xóa toàn bộ bảng khách hàng để test lại',
        targetResource: { domain: 'devops', type: 'database_table', id: 'customers' },
      });

      expect(result.verdict).toBe(EPolicyVerdict.DENY);
      expect(result.citedRuleId).toBe('SEC-DEVOPS-001');
      expect(result.reason).toContain('nghiêm cấm');
    });

    it('ALLOWS safe read queries on database', async () => {
      const result = await evaluator.evaluate({
        userId: 'dev-01',
        provider: 'sql_server',
        toolName: 'read_query',
        args: {
          query: 'SELECT id, name, price FROM products WHERE status = "active"',
        },
        userIntent: 'Xem danh sách sản phẩm',
        targetResource: { domain: 'devops', type: 'database_table', id: 'products' },
      });

      expect(result.verdict).toBe(EPolicyVerdict.ALLOW);
    });
  });

  describe('HR Domain Guardrails', () => {
    it('DENIES salary and payroll queries citing SEC-HR-001', async () => {
      const result = await evaluator.evaluate({
        userId: 'guest-01',
        provider: 'hr_portal',
        toolName: 'query_employee_records',
        args: {
          department: 'accounting',
          field: 'salary',
        },
        userIntent: 'Trích xuất bảng lương phòng kế toán',
        targetResource: { domain: 'hr', type: 'employee_record', id: 'payroll_all' },
      });

      expect(result.verdict).toBe(EPolicyVerdict.DENY);
      expect(result.citedRuleId).toBe('SEC-HR-001');
      expect(result.reason).toContain('Bảng lương và thu nhập');
    });
  });

  describe('Finance & Support Domain Guardrails', () => {
    it('ALLOWS small refunds under 200.000 VNĐ automatically', async () => {
      const result = await evaluator.evaluate({
        userId: 'user-01',
        provider: 'finance',
        toolName: 'process_refund',
        args: {
          orderId: '103',
          amount: 99000,
        },
        userIntent: 'Hoàn tiền cho áo thun bị lỗi',
        targetResource: { domain: 'finance', type: 'payment', id: '103' },
      });

      expect(result.verdict).toBe(EPolicyVerdict.ALLOW);
    });

    it('REQUIRES APPROVAL for medium refunds between 200.000 and 2.000.000 VNĐ', async () => {
      const result = await evaluator.evaluate({
        userId: 'user-01',
        provider: 'finance',
        toolName: 'process_refund',
        args: {
          orderId: '104',
          amount: 500000,
        },
        userIntent: 'Hoàn tiền đơn hàng giày thể thao',
        targetResource: { domain: 'finance', type: 'payment', id: '104' },
      });

      expect(result.verdict).toBe(EPolicyVerdict.REQUIRE_APPROVAL);
      expect(result.suggestedAction).toContain('HITL');
    });

    it('ESCALATES large refunds >= 2.000.000 VNĐ to human supervisor citing SEC-FIN-001', async () => {
      const result = await evaluator.evaluate({
        userId: 'user-01',
        provider: 'finance',
        toolName: 'process_refund',
        args: {
          orderId: '102',
          amount: 2500000,
        },
        userIntent: 'Hoàn tiền đơn hàng 102 giá trị lớn',
        targetResource: { domain: 'finance', type: 'payment', id: '102' },
      });

      expect(result.verdict).toBe(EPolicyVerdict.ESCALATE);
      expect(result.citedRuleId).toBe('SEC-FIN-001');
      expect(result.reason).toContain('vượt quá thẩm quyền');
    });

    it('DENIES cancellation of orders currently in SHIPPING status', async () => {
      const result = await evaluator.evaluate({
        userId: 'user-01',
        provider: 'shop_backend',
        toolName: 'cancel_order',
        args: {
          orderId: '102',
          status: EOrderStatus.SHIPPING,
        },
        userIntent: 'Hủy đơn hàng đang trên đường giao',
        targetResource: { domain: 'support', type: 'order', id: '102' },
      });

      expect(result.verdict).toBe(EPolicyVerdict.DENY);
      expect(result.citedRuleId).toBe('SEC-SUPPORT-001');
      expect(result.reason).toContain('vận chuyển');
    });
  });

  describe('LLM-as-a-Judge Execution', () => {
    it('calls strategy.generateStructured when strategy and model are provided', async () => {
      const mockStrategy = {
        id: 'mock-llm',
        generateStructured: jest.fn().mockResolvedValue({
          verdict: EPolicyVerdict.REQUIRE_APPROVAL,
          reason: 'Phát hiện thao tác cấu hình máy chủ có khả năng ảnh hưởng tới lưu lượng mạng.',
          citedRuleId: 'SEC-CUSTOM-99',
          citedRuleTitle: 'Thay đổi network config',
        }),
      } as unknown as LlmStrategy;

      const result = await evaluator.evaluate(
        {
          userId: 'dev-admin',
          provider: 'k8s_ops',
          toolName: 'apply_ingress_route',
          args: { host: 'api.enterprise.com' },
          targetResource: { domain: 'devops', type: 'config', id: 'ingress' },
        },
        {
          strategy: mockStrategy,
          model: 'gemini-2.0-flash',
        },
      );

      expect(mockStrategy.generateStructured).toHaveBeenCalled();
      expect(result.verdict).toBe(EPolicyVerdict.REQUIRE_APPROVAL);
      expect(result.citedRuleId).toBe('SEC-CUSTOM-99');
    });

    it('falls back to deterministic judge if LLM-as-a-Judge throws an error', async () => {
      const failingStrategy = {
        id: 'failing-llm',
        generateStructured: jest.fn().mockRejectedValue(new Error('LLM Quota Exceeded')),
      } as unknown as LlmStrategy;

      const result = await evaluator.evaluate(
        {
          userId: 'dev-01',
          provider: 'sql_server',
          toolName: 'execute_write_query',
          args: { query: 'TRUNCATE TABLE logs' },
          targetResource: { domain: 'devops', type: 'database_table', id: 'logs' },
        },
        {
          strategy: failingStrategy,
          model: 'gemini-2.0-flash',
        },
      );

      expect(result.verdict).toBe(EPolicyVerdict.DENY);
      expect(result.citedRuleId).toBe('SEC-DEVOPS-001');
    });

    it('evaluatePrompt() từ chối ngay từ prompt nếu người dùng yêu cầu lệnh cấm DROP TABLE', async () => {
      const result = await evaluator.evaluatePrompt('Chạy lệnh DROP TABLE users để giải phóng ổ cứng');
      expect(result.verdict).toBe(EPolicyVerdict.DENY);
      expect(result.citedRuleId).toBe('SEC-DEVOPS-001');
    });

    it('evaluatePrompt() trả REQUIRE_APPROVAL cho prompt 6.12 cấu hình định tuyến Ingress diện rộng', async () => {
      const result = await evaluator.evaluatePrompt(
        'Áp dụng cấu hình định tuyến ingress mới: chuyển hướng toàn bộ traffic đường dẫn /api/v2/auth và /api/v2/payments sang cụm máy chủ thử nghiệm dev-cluster-external.',
      );
      expect(result.verdict).toBe(EPolicyVerdict.REQUIRE_APPROVAL);
      expect(result.citedRuleId).toBe('SEC-DEVOPS-002');
    });

    it('evaluatePrompt() trả ALLOW cho câu hỏi thông thường không chạm quy chế cấm', async () => {
      const result = await evaluator.evaluatePrompt('Kiểm tra thời tiết hôm nay tại Hà Nội');
      expect(result.verdict).toBe(EPolicyVerdict.ALLOW);
    });
  });
});
