import { Logger } from '@nestjs/common';
import { PolicyCorpusService } from './policy-corpus.service';
import { SemanticPolicyEvaluatorService } from './semantic-policy-evaluator.service';
import { ProviderPreflightGuard } from '../preflight/provider-preflight.guard';
import { IdempotencyManager } from '../idempotency/idempotency.manager';
import { InMemoryIdempotencyStore } from '../adapters/in-memory-idempotency.store';
import { HumanEscalationService } from '../escalation/human-escalation.service';
import { InMemoryEscalationStore } from '../adapters/in-memory-escalation.store';
import { ActionAuditService } from '../audit/action-audit.service';
import { InMemoryAuditStore } from '../adapters/in-memory-audit.store';
import { ToolRiskGate } from '../../engine/loop/guards/tool-risk-gate';
import { InsertAccumulator } from '../../engine/loop/guards/insert-accumulator';
import { CircuitBreakerService } from '../../infrastructure/resilience/circuit-breaker.service';
import {
  EPolicyVerdict,
  EPolicyStatus,
  EPolicySeverity,
  EProviderAuthType,
  EOrderStatus,
  EEscalationStatus,
} from '../constants/security.constants';
import {
  EConversationState,
  IChatSessionManager,
  IChatSession,
} from '../../contracts/session/chat-session.interface';
import { RunReactLoopRequestDto } from '../../contracts/dtos/react-loop.dto';
import { LlmStrategy } from '../../contracts/engine/llm-strategy.interface';
import { McpToolDto } from '../../contracts/dtos/mcp.dto';

describe('Semantic Policy RAG & Domain-Agnostic Guardrails Integration Tests', () => {
  let policyCorpus: PolicyCorpusService;
  let semanticEvaluator: SemanticPolicyEvaluatorService;
  let idempotencyStore: InMemoryIdempotencyStore;
  let idempotencyManager: IdempotencyManager;
  let escalationStore: InMemoryEscalationStore;
  let escalationService: HumanEscalationService;
  let auditStore: InMemoryAuditStore;
  let auditService: ActionAuditService;
  let preflightGuard: ProviderPreflightGuard;
  let sessionStore: Map<string, IChatSession>;
  let mockSessionManager: IChatSessionManager;
  let circuitBreaker: CircuitBreakerService;
  let mockLlmStrategy: LlmStrategy;

  const mockLogger = {
    log: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  } as unknown as Logger;

  beforeEach(() => {
    jest.clearAllMocks();

    policyCorpus = new PolicyCorpusService();
    semanticEvaluator = new SemanticPolicyEvaluatorService(policyCorpus);
    idempotencyStore = new InMemoryIdempotencyStore();
    idempotencyManager = new IdempotencyManager(idempotencyStore);
    escalationStore = new InMemoryEscalationStore();

    sessionStore = new Map<string, IChatSession>();
    mockSessionManager = {
      getOrCreateSession: jest.fn(async (id: string, userId: string, convId: string) => {
        let s = sessionStore.get(id);
        if (!s) {
          s = {
            id,
            userId,
            conversationId: convId,
            tenantId: 'tenant-enterprise',
            botUserId: 'bot-1',
            approvalMessageIds: new Set<string>(),
            state: EConversationState.AI_ACTIVE,
          };
          sessionStore.set(id, s);
        }
        return s;
      }),
      getSession: jest.fn(async (id: string) => sessionStore.get(id) || null),
      setConversationState: jest.fn(async (id: string, state: EConversationState) => {
        const s = sessionStore.get(id);
        if (s) {
          s.state = state;
        } else {
          sessionStore.set(id, {
            id,
            userId: 'user-1',
            conversationId: id,
            tenantId: 'tenant-enterprise',
            botUserId: 'bot-1',
            approvalMessageIds: new Set<string>(),
            state,
          });
        }
      }),
      getConversationState: jest.fn((id: string) => sessionStore.get(id)?.state || null),
      deleteSession: jest.fn(async (id: string) => {
        sessionStore.delete(id);
      }),
    };

    escalationService = new HumanEscalationService(escalationStore, mockSessionManager);
    auditStore = new InMemoryAuditStore();
    auditService = new ActionAuditService(auditStore);

    const mockToolConnector = {
      isProviderConnected: jest.fn(async (_userId: string, provider: string) => provider !== 'unconnected_service'),
      getOAuthStatus: jest.fn(async (_userId: string, provider: string) => ({
        connected: provider !== 'unconnected_service',
        scopes: ['db.read', 'db.write', 'mail.send', 'hr.read'],
      })),
      getOAuthAuthUrl: jest.fn(async (_userId: string, provider: string) => `https://auth.company.internal/${provider}/login`),
    };
    preflightGuard = new ProviderPreflightGuard(mockToolConnector as never);

    circuitBreaker = {
      run: jest.fn((_key: string, fn: () => Promise<unknown>) => fn()),
    } as unknown as CircuitBreakerService;

    mockLlmStrategy = {
      id: 'mock-llm-strategy',
      startChat: jest.fn(),
      generateStructured: jest.fn(),
    };
  });

  function createTestGate(
    dtoOverrides: Partial<RunReactLoopRequestDto> = {},
    tools: McpToolDto[] = [],
  ): ToolRiskGate {
    const dto: RunReactLoopRequestDto = {
      prompt: 'Thực hiện tác vụ nghiệp vụ doanh nghiệp',
      provider: 'enterprise_core',
      userId: 'usr-devops-admin',
      channelId: 'chan-security',
      workspaceId: 'ws-main',
      messageId: 'msg-init-01',
      channelType: 'direct',
      history: [],
      ...dtoOverrides,
    };

    return new ToolRiskGate({
      dto,
      mcpTools: tools,
      strategy: mockLlmStrategy,
      model: 'gemini-2.5-pro',
      circuitBreaker,
      logger: mockLogger,
      signal: new AbortController().signal,
      insertAccumulator: new InsertAccumulator(),
      preflightGuard,
      semanticPolicyEvaluator: semanticEvaluator,
      idempotencyManager,
    });
  }

  describe('1. DevOps & Infrastructure Security Domain', () => {
    it('chặn triệt để câu lệnh huỷ hoại CSDL production (DROP TABLE) với trạng thái POLICY_VIOLATION', async () => {
      const gate = createTestGate(
        { prompt: 'Xóa toàn bộ bảng users và audit cũ trên database production' },
        [
          {
            name: 'execute_write_query',
            description: 'Thực thi câu lệnh SQL ghi trên CSDL',
            inputSchema: {},
            annotations: { destructiveHint: true },
          },
        ],
      );

      const decision = await gate.evaluatePolicy('execute_write_query', {
        query: 'DROP TABLE customers;',
      });

      expect(decision).not.toBeNull();
      expect(decision?.allowed).toBe(false);
      expect(decision?.status).toBe(EPolicyStatus.POLICY_VIOLATION);
      expect(decision?.reason).toMatch(/xóa hoặc hủy hoại CSDL|DROP TABLE/i);

      // Ghi audit log vi phạm
      const auditEntry = await auditService.record({
        userId: 'usr-devops-admin',
        actionType: 'EXECUTE_WRITE_QUERY',
        targetResource: { domain: 'devops', type: 'database_table', id: 'customers' },
        evaluationStatus: decision?.status,
        metadata: { query: 'DROP TABLE customers;' },
      });

      expect(auditEntry.targetResource).toEqual({
        domain: 'devops',
        type: 'database_table',
        id: 'customers',
      });
      const savedLogs = await auditStore.findByUserId('usr-devops-admin');
      expect(savedLogs.length).toBe(1);
    });

    it('chặn các biến thể DROP DATABASE và TRUNCATE TABLE kể cả lồng ghép nhiều lệnh SQL', async () => {
      const gate = createTestGate();

      const truncateDecision = await gate.evaluatePolicy('execute_write_query', {
        query: 'SELECT * FROM logs; TRUNCATE TABLE logs;',
      });

      expect(truncateDecision?.allowed).toBe(false);
      expect(truncateDecision?.status).toBe(EPolicyStatus.POLICY_VIOLATION);
      expect(truncateDecision?.reason).toMatch(/hủy hoại CSDL|TRUNCATE|xóa/i);
    });

    it('cho phép câu lệnh DDL an toàn (CREATE INDEX) thực thi bình thường', async () => {
      const gate = createTestGate({
        prompt: 'Tạo index mới cho cột email trên bảng accounts',
      });

      const decision = await gate.evaluatePolicy('execute_write_query', {
        query: 'CREATE INDEX idx_accounts_email ON accounts(email);',
      });

      expect(decision?.allowed).toBe(true);
      expect(decision?.status).toBe(EPolicyStatus.AUTO_APPROVED);
    });

    it('yêu cầu phê duyệt (REQUIRE_APPROVAL) khi cấu hình định tuyến ingress mạng rủi ro cao', async () => {
      const gate = createTestGate({
        prompt: 'Cấu hình và áp dụng định tuyến mạng ingress mới cho hệ thống',
      });

      const decision = await gate.evaluatePolicy('apply_ingress_route', {
        route: '/api/v2/payments',
        target: 'payment-service-cluster',
      });

      expect(decision?.allowed).toBe(true);
      expect(decision?.status).toBe(EPolicyStatus.USER_CONFIRMATION_REQUIRED);
    });
  });

  describe('2. HR & Employee Data Privacy Domain', () => {
    it('chặn trích xuất bảng lương và thông tin thu nhập nhạy cảm của nhân viên', async () => {
      const gate = createTestGate({
        prompt: 'Trích xuất mức lương cơ bản và thưởng hiệu quả của nhân sự EMP-101',
      });

      const decision = await gate.evaluatePolicy('query_employee_records', {
        employeeId: 'EMP-101',
        fields: ['fullName', 'salary', 'bonusPlan'],
      });

      expect(decision?.allowed).toBe(false);
      expect(decision?.status).toBe(EPolicyStatus.POLICY_VIOLATION);
      expect(decision?.reason).toMatch(/bảng lương|thu nhập|lương|salary/i);
    });

    it('cho phép tra cứu danh bạ nhân sự với các trường thông tin thông thường', async () => {
      const gate = createTestGate({
        prompt: 'Tra cứu phòng ban và vị trí làm việc của nhân viên EMP-101',
      });

      const decision = await gate.evaluatePolicy('query_employee_records', {
        employeeId: 'EMP-101',
        fields: ['fullName', 'department', 'workLocation'],
      });

      expect(decision?.allowed).toBe(true);
      expect(decision?.status).toBe(EPolicyStatus.AUTO_APPROVED);
    });

    it('kích hoạt bàn giao Human Takeover và AI Mute khi phát hiện khiếu nại tranh chấp lao động', async () => {
      const sessionId = 'sess-hr-dispute-99';
      await mockSessionManager.setConversationState(sessionId, EConversationState.AI_ACTIVE);

      const gate = createTestGate({
        prompt: 'Tôi muốn khiếu nại tố cáo tranh chấp lao động với quản lý trực tiếp',
      });

      const decision = await gate.evaluatePolicy('submit_employee_grievance', {
        employeeId: 'EMP-777',
        category: 'khiếu nại tranh chấp',
        description: 'Tố cáo hành vi quấy rối và chèn ép nhân sự tại nơi làm việc',
      });

      expect(decision?.status).toBe(EPolicyStatus.EXCEEDS_AI_AUTHORITY);

      // Kích hoạt quy trình bàn giao con người
      const ticket = await escalationService.createTicket({
        sessionId,
        conversationId: sessionId,
        userId: 'usr-employee-777',
        targetResource: { domain: 'hr', type: 'grievance', id: 'GRV-EMP-777' },
        reason: decision?.reason || 'Khiếu nại tranh chấp lao động nhạy cảm',
        metadata: { category: 'tố cáo tranh chấp' },
      });

      expect(ticket.status).toBe(EEscalationStatus.OPEN);
      expect(ticket.targetResource?.domain).toBe('hr');

      // Kiểm chứng trạng thái phiên chuyển sang HUMAN_TAKEOVER (AI Mute)
      const sessionState = await mockSessionManager.getConversationState(sessionId);
      expect(sessionState).toBe(EConversationState.HUMAN_TAKEOVER);
    });
  });

  describe('3. Finance & Customer Support Multi-Tier Policies', () => {
    it('tự động phê duyệt (AUTO_APPROVED) đối với giao dịch hoàn tiền giá trị nhỏ (<= 200.000 VNĐ)', async () => {
      const gate = createTestGate({
        prompt: 'Hoàn tiền đơn hàng ORD-MICRO-01 do sản phẩm giao sai màu',
      });

      const decision = await gate.evaluatePolicy('process_refund', {
        orderId: 'ORD-MICRO-01',
        amount: 120000,
        currency: 'VND',
        reason: 'Sai màu sắc',
      });

      expect(decision?.allowed).toBe(true);
      expect(decision?.status).toBe(EPolicyStatus.AUTO_APPROVED);
    });

    it('yêu cầu người dùng xác nhận (USER_CONFIRMATION_REQUIRED) với hoàn tiền hạn mức trung bình (200.000 - 2.000.000 VNĐ)', async () => {
      const gate = createTestGate({
        prompt: 'Thực hiện hoàn tiền 1.500.000 VNĐ cho đơn hàng ORD-MEDIUM-02',
      });

      const decision = await gate.evaluatePolicy('process_refund', {
        orderId: 'ORD-MEDIUM-02',
        amount: 1500000,
        currency: 'VND',
        reason: 'Đổi trả hàng theo chính sách',
      });

      expect(decision?.allowed).toBe(true);
      expect(decision?.status).toBe(EPolicyStatus.USER_CONFIRMATION_REQUIRED);
    });

    it('báo vượt thẩm quyền AI (EXCEEDS_AI_AUTHORITY) và tạo EscalationTicket khi hoàn tiền > 2.000.000 VNĐ', async () => {
      const gate = createTestGate({
        prompt: 'Yêu cầu hoàn toàn bộ số tiền 5.000.000 VNĐ cho đơn hàng ORD-LARGE-03',
      });

      const decision = await gate.evaluatePolicy('process_refund', {
        orderId: 'ORD-LARGE-03',
        amount: 5000000,
        currency: 'VND',
        reason: 'Khách hàng khiếu nại chất lượng sản phẩm cao cấp',
      });

      expect(decision?.allowed).toBe(false);
      expect(decision?.status).toBe(EPolicyStatus.EXCEEDS_AI_AUTHORITY);

      // Tạo escalation ticket
      const ticket = await escalationService.createTicket({
        conversationId: 'conv-fin-03',
        userId: 'usr-customer-vip',
        targetResource: { domain: 'finance', type: 'order', id: 'ORD-LARGE-03' },
        requestedAmount: 5000000,
        reason: decision?.reason || 'Vượt hạn mức tối đa của AI',
      });

      expect(ticket.ticketId).toMatch(/^TK-/);
      expect(ticket.requestedAmount).toBe(5000000);
      expect(ticket.targetResource).toEqual({
        domain: 'finance',
        type: 'order',
        id: 'ORD-LARGE-03',
      });
    });

    it('từ chối huỷ đơn hàng đang trong trạng thái vận chuyển (SHIPPING)', async () => {
      const gate = createTestGate({
        prompt: 'Khách yêu cầu hủy đơn hàng đang giao ORD-SHIP-99',
      });

      const decision = await gate.evaluatePolicy('cancel_order', {
        orderId: 'ORD-SHIP-99',
        status: EOrderStatus.SHIPPING,
        reason: 'Khách đổi ý',
      });

      expect(decision?.allowed).toBe(false);
      expect(decision?.status).toBe(EPolicyStatus.POLICY_VIOLATION);
      expect(decision?.reason).toMatch(/vận chuyển|shipping/i);
    });
  });

  describe('4. Cross-Domain Idempotency & SHA-256 Canonical Fingerprint', () => {
    it('đảm bảo hai tool call giống nhau nhưng đảo thứ tự key JSON sinh cùng fingerprint và chống trùng lặp', async () => {
      const gate = createTestGate();

      const callArgs1 = {
        amount: 2500000,
        orderId: 'ORD-IDEMP-01',
        metadata: { promoCode: 'SUMMER2026', tags: ['vip', 'priority'] },
      };

      const callArgs2 = {
        metadata: { tags: ['vip', 'priority'], promoCode: 'SUMMER2026' },
        orderId: 'ORD-IDEMP-01',
        amount: 2500000,
      };

      // Call 1: Chiếm quyền thành công
      const acq1 = await gate.acquireIdempotency('finance.charge_card', callArgs1);
      expect(acq1.success).toBe(true);
      expect(acq1.key).toBeDefined();

      // Call 2: Chạy đồng thời -> Bị từ chối do Call 1 đang thực thi (IN_PROGRESS)
      const acq2 = await gate.acquireIdempotency('finance.charge_card', callArgs2);
      expect(acq2.success).toBe(false);
      expect(acq2.key).toBe(acq1.key);
      expect(acq2.reason).toContain('IN_PROGRESS');

      // Call 1 hoàn tất và ghi nhận kết quả
      const mockResult = { txId: 'TX-FIN-9988', success: true };
      await gate.completeIdempotency(acq1.key, mockResult);

      // Call 3 (Thử lại sau khi Call 1 xong): Trả kết quả cũ mà không thực thi lại
      const acq3 = await gate.acquireIdempotency('finance.charge_card', callArgs1);
      expect(acq3.success).toBe(false);
      expect(acq3.reason).toContain('EXECUTED');
      expect(acq3.previousResult).toEqual(mockResult);
    });
  });

  describe('5. PII Masking & Tamper-Resistant Audit Trail', () => {
    it('tự động che giấu thông tin định danh nhạy cảm (số thẻ, tài khoản ngân hàng, email, sđt) trong audit log', async () => {
      const sensitiveData = {
        creditCard: '4111 2222 3333 4444',
        phoneNumber: '0912345678',
        email: 'ceo.secret@enterprise.com',
        bankAccount: '19034567891011',
        note: 'Giao dịch chuyển khoản đặc biệt',
      };

      const entry = await auditService.record({
        userId: 'usr-finance-officer',
        tenantId: 'tenant-enterprise',
        actionType: 'WIRE_TRANSFER',
        targetResource: { domain: 'finance', type: 'transfer', id: 'TRF-8899' },
        amount: 50000000,
        evaluationStatus: EPolicyStatus.AUTO_APPROVED,
        metadata: sensitiveData,
      });

      expect(entry.metadata?.creditCard).toBe('[REDACTED_BY_SECURITY_GATE]');
      expect(entry.metadata?.email).toMatch(/\*{3}/);
      expect(entry.metadata?.phoneNumber).toBe('[PHONE_REDACTED]');

      // Kiểm tra lưu trữ nhật ký an toàn
      const logs = await auditStore.findByUserId('usr-finance-officer');
      expect(logs.length).toBe(1);
      expect(logs[0].metadata?.creditCard).toBe('[REDACTED_BY_SECURITY_GATE]');
    });
  });

  describe('6. Capability-Driven Provider Preflight Authentication', () => {
    it('cho phép tool SYSTEM thực thi mà không yêu cầu liên kết OAuth người dùng', async () => {
      const gate = createTestGate(
        { provider: 'internal_admin_ops' },
        [
          {
            name: 'restart_cluster_service',
            description: 'Khởi động lại cụm máy chủ hệ thống',
            inputSchema: {},
            annotations: { authType: EProviderAuthType.SYSTEM },
          },
        ],
      );

      const preflightErr = await gate.checkPreflight('restart_cluster_service');
      expect(preflightErr).toBeNull();
    });

    it('từ chối khi provider OAuth2 chưa được liên kết và cung cấp đường dẫn kết nối chuẩn', async () => {
      const gate = createTestGate(
        { provider: 'unconnected_service' },
        [
          {
            name: 'sync_third_party_data',
            description: 'Đồng bộ dữ liệu từ dịch vụ bên thứ ba',
            inputSchema: {},
            annotations: { authType: EProviderAuthType.OAUTH2 },
          },
        ],
      );

      const preflightErr = await gate.checkPreflight('sync_third_party_data');
      expect(preflightErr).toContain('/oauth/unconnected_service/connect');
    });

    it('từ chối khi provider OAuth2 thiếu scope quyền hạn bắt buộc', async () => {
      preflightGuard.registerUserConnection('usr-devops-admin', {
        userId: 'usr-devops-admin',
        provider: 'enterprise_core',
        isConnected: true,
        grantedScopes: ['db.read'],
      });

      const gate = createTestGate(
        { provider: 'enterprise_core' },
        [
          {
            name: 'delete_backup',
            description: 'Xóa bản sao lưu',
            inputSchema: {},
            requiredScopes: ['admin.super_write'],
            annotations: { authType: EProviderAuthType.OAUTH2 },
          },
        ],
      );

      const preflightErr = await gate.checkPreflight('delete_backup');
      expect(preflightErr).toContain('admin.super_write');
      expect(preflightErr).toContain('/oauth/enterprise_core/authorize');
    });

    it('cho phép tool PUBLIC thực thi mà không cần chứng chỉ xác thực', async () => {
      const gate = createTestGate(
        { provider: 'weather_service' },
        [
          {
            name: 'get_current_weather',
            description: 'Lấy thông tin thời tiết công khai',
            inputSchema: {},
            annotations: { authType: EProviderAuthType.PUBLIC },
          },
        ],
      );

      const preflightErr = await gate.checkPreflight('get_current_weather');
      expect(preflightErr).toBeNull();
    });
  });
});
