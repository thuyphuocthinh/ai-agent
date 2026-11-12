import { Logger } from '@nestjs/common';
import { ToolRiskGate } from './tool-risk-gate';
import { InsertAccumulator } from './insert-accumulator';
import { RunReactLoopRequestDto } from '../../../contracts/dtos/react-loop.dto';
import { McpToolDto } from '../../../contracts/dtos/mcp.dto';
import { LlmStrategy } from '../../../contracts/engine/llm-strategy.interface';
import { CircuitBreakerService } from '../../../infrastructure/resilience/circuit-breaker.service';
import {
  EProviderAuthType,
  EPolicyVerdict,
  EPolicyStatus,
} from '../../../security';

describe('ToolRiskGate', () => {
  const baseDto: RunReactLoopRequestDto = {
    prompt: 'tạo 5 sản phẩm mới',
    provider: 'sql_server',
    userId: 'user-1',
    channelId: 'channel-1',
    workspaceId: 'workspace-1',
    messageId: 'reply-msg-1',
    channelType: 'direct',
    history: [],
  };

  const logger = { warn: jest.fn(), log: jest.fn() } as unknown as Logger;
  const circuitBreaker = {
    run: jest.fn((_key: string, action: () => Promise<unknown>) => action()),
  } as unknown as CircuitBreakerService;

  function createStrategy(): LlmStrategy {
    return {
      id: 'test-strategy',
      startChat: jest.fn(),
      generateStructured: jest.fn(),
    };
  }

  function createGate(
    overrides: Partial<{
      dto: RunReactLoopRequestDto;
      mcpTools: McpToolDto[];
      strategy: LlmStrategy;
    }> = {},
  ) {
    const strategy = overrides.strategy ?? createStrategy();
    const gate = new ToolRiskGate({
      dto: overrides.dto ?? baseDto,
      mcpTools: overrides.mcpTools ?? [],
      strategy,
      model: 'gemini-2.0-flash',
      circuitBreaker,
      logger,
      signal: new AbortController().signal,
      insertAccumulator: new InsertAccumulator(),
    });
    return { gate, strategy };
  }

  afterEach(() => jest.clearAllMocks());

  describe('isDestructive()', () => {
    it('trả true khi mcpTools khai destructiveHint cho đúng tool đó', () => {
      const { gate } = createGate({
        mcpTools: [
          {
            name: 'execute_write_query',
            description: 'desc',
            inputSchema: {},
            annotations: { destructiveHint: true },
          },
        ],
      });

      expect(gate.isDestructive('execute_write_query')).toBe(true);
    });

    it('trả false khi tool không có destructiveHint hoặc không có trong mcpTools', () => {
      const { gate } = createGate({
        mcpTools: [
          { name: 'get_database_schema', description: 'desc', inputSchema: {} },
        ],
      });

      expect(gate.isDestructive('get_database_schema')).toBe(false);
      expect(gate.isDestructive('unknown_tool')).toBe(false);
    });
  });

  describe('isAutoApprovableInsert()', () => {
    it('trả true cho execute_write_query của sql_server với câu INSERT thật', () => {
      const { gate } = createGate();

      expect(
        gate.isAutoApprovableInsert('execute_write_query', {
          query: "INSERT INTO Products (Name) VALUES ('A')",
        }),
      ).toBe(true);
    });

    it('trả true cho INSERT ... SELECT TOP N có giới hạn tĩnh', () => {
      const { gate } = createGate();

      expect(
        gate.isAutoApprovableInsert('execute_write_query', {
          query:
            "INSERT INTO Products (Name) SELECT TOP 50 CONCAT('Product ', NEWID()) FROM master..spt_values",
        }),
      ).toBe(true);
    });

    it('trả false khi provider không phải sql_server', () => {
      const { gate } = createGate({ dto: { ...baseDto, provider: 'github' } });

      expect(
        gate.isAutoApprovableInsert('execute_write_query', {
          query: "INSERT INTO Products (Name) VALUES ('A')",
        }),
      ).toBe(false);
    });

    it('trả false cho tool khác execute_write_query', () => {
      const { gate } = createGate();

      expect(
        gate.isAutoApprovableInsert('some_other_tool', {
          query: "INSERT INTO Products (Name) VALUES ('A')",
        }),
      ).toBe(false);
    });

    it('trả false khi câu lệnh không phải INSERT (VD UPDATE/DELETE)', () => {
      const { gate } = createGate();

      expect(
        gate.isAutoApprovableInsert('execute_write_query', {
          query: "UPDATE Orders SET Status='Done' WHERE OrderId=1",
        }),
      ).toBe(false);
    });

    it('trả false khi args không có query dạng string', () => {
      const { gate } = createGate();

      expect(gate.isAutoApprovableInsert('execute_write_query', {})).toBe(
        false,
      );
    });
  });

  describe('checkBulkInsertShortfall()', () => {
    it('trả null ngay khi tool/câu lệnh không giống create/insert (không cần gọi LLM đếm requiredCount)', async () => {
      const { gate, strategy } = createGate();

      const result = await gate.checkBulkInsertShortfall(
        'sql_server.execute_read_only_query',
        'SELECT * FROM Products',
        { query: 'SELECT * FROM Products' },
      );

      expect(result).toBeNull();
      expect(strategy.generateStructured).not.toHaveBeenCalled();
    });

    it('trả null khi getRequiredCount() (LLM) trả về 0 — task không có yêu cầu số lượng cụ thể', async () => {
      const strategy = createStrategy();
      (strategy.generateStructured as jest.Mock).mockResolvedValue({
        requiredCount: 0,
      });
      const { gate } = createGate({ strategy });
      const query = "INSERT INTO Products (Name) VALUES ('A')";

      const result = await gate.checkBulkInsertShortfall(
        'sql_server.execute_write_query',
        query,
        { query },
      );

      expect(result).toBeNull();
    });

    it('trả shortfallMessage khi số tuple gộp được vẫn ít hơn requiredCount', async () => {
      const strategy = createStrategy();
      (strategy.generateStructured as jest.Mock).mockResolvedValue({
        requiredCount: 5,
      });
      const { gate } = createGate({ strategy });
      const query = "INSERT INTO Products (Name) VALUES ('A')";
      const args = { query };

      const result = await gate.checkBulkInsertShortfall(
        'sql_server.execute_write_query',
        query,
        args,
      );

      expect(result).toContain('1/5');
      expect(args.query).toBe(query); // KHÔNG bị ghi đè khi còn thiếu
    });

    it('gộp tuple tích luỹ đủ requiredCount thì ghi đè args.query và trả null (cho phép auto-approve chạy)', async () => {
      const strategy = createStrategy();
      (strategy.generateStructured as jest.Mock).mockResolvedValue({
        requiredCount: 2,
      });
      const { gate } = createGate({ strategy });
      const argsA = { query: "INSERT INTO Products (Name) VALUES ('A')" };
      const argsB = { query: "INSERT INTO Products (Name) VALUES ('B')" };

      const first = await gate.checkBulkInsertShortfall(
        'sql_server.execute_write_query',
        argsA.query,
        argsA,
      );
      expect(first).not.toBeNull();

      const second = await gate.checkBulkInsertShortfall(
        'sql_server.execute_write_query',
        argsB.query,
        argsB,
      );

      expect(second).toBeNull();
      expect(argsB.query).toBe(
        "INSERT INTO Products (Name) VALUES ('A'), ('B')",
      );
    });
  });

  describe('clearAccumulatorFor()', () => {
    it('xoá tuple đã gộp cho bảng đó — lần checkBulkInsertShortfall() sau bắt đầu lại từ đầu', async () => {
      const strategy = createStrategy();
      (strategy.generateStructured as jest.Mock).mockResolvedValue({
        requiredCount: 5,
      });
      const { gate } = createGate({ strategy });
      const query = "INSERT INTO Products (Name) VALUES ('A')";
      await gate.checkBulkInsertShortfall(
        'sql_server.execute_write_query',
        query,
        { query },
      );

      gate.clearAccumulatorFor(query);

      const afterClear = await gate.checkBulkInsertShortfall(
        'sql_server.execute_write_query',
        "INSERT INTO Products (Name) VALUES ('B')",
        { query: "INSERT INTO Products (Name) VALUES ('B')" },
      );
      expect(afterClear).toContain('1/5');
    });
  });

  describe('Security Integration (Preflight, Policy, Idempotency)', () => {
    it('checkPreflight() trả lỗi định dạng khi preflight guard báo not ready', async () => {
      const mockPreflight = {
        check: jest.fn().mockResolvedValue({
          ready: false,
          status: 'PROVIDER_NOT_CONNECTED',
          provider: 'google_mail',
          reauthUrl: 'https://auth.example.com',
        }),
        formatActionableMessage: jest.fn().mockReturnValue('Vui lòng kết nối Google Mail tại https://auth.example.com'),
      };

      const gate = new ToolRiskGate({
        dto: { ...baseDto, provider: 'google_mail' },
        mcpTools: [{ name: 'send_mail', description: '', inputSchema: {}, annotations: { requiredScopes: ['mail.send'] } }],
        strategy: createStrategy(),
        model: 'gemini-2.0-flash',
        circuitBreaker,
        logger,
        signal: new AbortController().signal,
        insertAccumulator: new InsertAccumulator(),
        preflightGuard: mockPreflight as never,
      });

      const error = await gate.checkPreflight('send_mail');
      expect(error).toContain('https://auth.example.com');
      expect(mockPreflight.check).toHaveBeenCalledWith(
        'user-1',
        'google_mail',
        ['mail.send'],
        EProviderAuthType.OAUTH2,
      );
    });

    it('checkPreflight() cho phép tool có authType SYSTEM (run_python) chạy ngay mà không đòi OAuth', async () => {
      const mockPreflight = {
        check: jest.fn().mockResolvedValue({
          ready: true,
          reason: 'READY',
          provider: 'compute',
        }),
        formatActionableMessage: jest.fn(),
      };

      const gate = new ToolRiskGate({
        dto: { ...baseDto, provider: 'compute' },
        mcpTools: [
          {
            name: 'run_python',
            authType: 'SYSTEM',
            description: '',
            inputSchema: {},
          },
        ],
        strategy: createStrategy(),
        model: 'gemini-2.0-flash',
        circuitBreaker,
        logger,
        signal: new AbortController().signal,
        insertAccumulator: new InsertAccumulator(),
        preflightGuard: mockPreflight as never,
      });

      const error = await gate.checkPreflight('run_python');
      expect(error).toBeNull();
      expect(mockPreflight.check).toHaveBeenCalledWith(
        'user-1',
        'compute',
        [],
        EProviderAuthType.SYSTEM,
      );
    });

    it('evaluatePolicy() ưu tiên SemanticPolicyEvaluatorService khi được cung cấp', async () => {
      const mockSemanticEvaluator = {
        evaluate: jest.fn().mockResolvedValue({
          verdict: EPolicyVerdict.REQUIRE_APPROVAL,
          reason: 'Cần phê duyệt từ cấp quản lý',
          matchingPolicies: [],
        }),
      };

      const gate = new ToolRiskGate({
        dto: baseDto,
        mcpTools: [],
        strategy: createStrategy(),
        model: 'gemini-2.0-flash',
        circuitBreaker,
        logger,
        signal: new AbortController().signal,
        insertAccumulator: new InsertAccumulator(),
        semanticPolicyEvaluator: mockSemanticEvaluator as never,
      });

      const result = await gate.evaluatePolicy('finance.issue_refund', { amount: 500 });
      expect(result).toEqual({
        allowed: true,
        status: EPolicyStatus.USER_CONFIRMATION_REQUIRED,
        reason: 'Cần phê duyệt từ cấp quản lý',
      });
      expect(mockSemanticEvaluator.evaluate).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user-1',
          provider: 'sql_server',
          toolName: 'finance.issue_refund',
          args: { amount: 500 },
        }),
        expect.anything(),
      );
    });

    it('evaluatePolicy() bỏ qua judge với tool nội bộ chỉ-đọc (SYSTEM + readOnlyHint), vẫn đánh giá tool khác', async () => {
      const mockSemanticEvaluator = {
        evaluate: jest.fn().mockResolvedValue({
          verdict: EPolicyVerdict.DENY,
          reason: 'vi phạm',
          matchingPolicies: [],
        }),
      };
      const gate = new ToolRiskGate({
        dto: baseDto,
        mcpTools: [
          {
            name: 'read_skill',
            inputSchema: {},
            authType: EProviderAuthType.SYSTEM,
            annotations: { readOnlyHint: true },
          },
          {
            name: 'system_write',
            inputSchema: {},
            authType: EProviderAuthType.SYSTEM,
          },
          { name: 'read_only_oauth', inputSchema: {}, annotations: { readOnlyHint: true } },
        ],
        strategy: createStrategy(),
        model: 'gemini-2.0-flash',
        circuitBreaker,
        logger,
        signal: new AbortController().signal,
        insertAccumulator: new InsertAccumulator(),
        semanticPolicyEvaluator: mockSemanticEvaluator as never,
      });

      await expect(gate.evaluatePolicy('read_skill', { slug: 'a' })).resolves.toBeNull();
      expect(mockSemanticEvaluator.evaluate).not.toHaveBeenCalled();

      await gate.evaluatePolicy('system_write', {});
      await gate.evaluatePolicy('read_only_oauth', {});
      expect(mockSemanticEvaluator.evaluate).toHaveBeenCalledTimes(2);
    });

    it('evaluatePolicy() tự động bypass Semantic Policy Evaluator với các tool schema discovery (table_schema)', async () => {
      const mockSemanticEvaluator = {
        evaluate: jest.fn().mockResolvedValue({
          verdict: EPolicyVerdict.DENY,
          reason: 'chặn nhầm',
        }),
      };
      const gate = new ToolRiskGate({
        dto: baseDto,
        mcpTools: [
          { name: 'sql_server.table_schema', inputSchema: {} },
          { name: 'table_schema', inputSchema: {} },
        ],
        strategy: createStrategy(),
        model: 'gemini-2.0-flash',
        circuitBreaker,
        logger,
        signal: new AbortController().signal,
        insertAccumulator: new InsertAccumulator(),
        semanticPolicyEvaluator: mockSemanticEvaluator as never,
      });

      await expect(gate.evaluatePolicy('table_schema', { table: 'orders' })).resolves.toBeNull();
      await expect(gate.evaluatePolicy('sql_server.table_schema', { table: 'orders' })).resolves.toBeNull();
      expect(mockSemanticEvaluator.evaluate).not.toHaveBeenCalled();
    });

    it('evaluatePolicy() tự động bypass Semantic Policy Evaluator với các tool schema discovery (table_schema)', async () => {
      const mockSemanticEvaluator = {
        evaluate: jest.fn().mockResolvedValue({
          verdict: EPolicyVerdict.DENY,
          reason: 'chặn nhầm',
        }),
      };
      const gate = new ToolRiskGate({
        dto: baseDto,
        mcpTools: [
          { name: 'sql_server.table_schema', inputSchema: {} },
          { name: 'table_schema', inputSchema: {} },
        ],
        strategy: createStrategy(),
        model: 'gemini-2.0-flash',
        circuitBreaker,
        logger,
        signal: new AbortController().signal,
        insertAccumulator: new InsertAccumulator(),
        semanticPolicyEvaluator: mockSemanticEvaluator as never,
      });

      await expect(gate.evaluatePolicy('table_schema', { table: 'orders' })).resolves.toBeNull();
      await expect(gate.evaluatePolicy('sql_server.table_schema', { table: 'orders' })).resolves.toBeNull();
      expect(mockSemanticEvaluator.evaluate).not.toHaveBeenCalled();
    });

    it('evaluatePolicy() fallback đến BusinessPolicyEngine theo action type', async () => {
      const mockPolicyEngine = {
        evaluate: jest.fn().mockReturnValue({
          status: 'EXCEEDS_AI_AUTHORITY',
          reason: 'Số tiền hoàn vượt 500k',
        }),
      };

      const gate = new ToolRiskGate({
        dto: baseDto,
        mcpTools: [],
        strategy: createStrategy(),
        model: 'gemini-2.0-flash',
        circuitBreaker,
        logger,
        signal: new AbortController().signal,
        insertAccumulator: new InsertAccumulator(),
        policyEngine: mockPolicyEngine as never,
      });

      const result = await gate.evaluatePolicy('refund_order', { orderId: '102', amount: 1_000_000 });
      expect(result?.status).toBe('EXCEEDS_AI_AUTHORITY');
      expect(mockPolicyEngine.evaluate).toHaveBeenCalledWith(
        'REFUND_ORDER',
        expect.objectContaining({ orderId: '102', amount: 1_000_000, userId: 'user-1' }),
      );
    });

    it('acquireIdempotency() và release/complete tương tác đúng với IdempotencyManager', async () => {
      const mockIdempotency = {
        acquireForTool: jest.fn().mockResolvedValue({
          success: true,
          fingerprint: 'idemp-key-102',
        }),
        complete: jest.fn().mockResolvedValue(undefined),
        release: jest.fn().mockResolvedValue(undefined),
      };

      const gate = new ToolRiskGate({
        dto: baseDto,
        mcpTools: [],
        strategy: createStrategy(),
        model: 'gemini-2.0-flash',
        circuitBreaker,
        logger,
        signal: new AbortController().signal,
        insertAccumulator: new InsertAccumulator(),
        idempotencyManager: mockIdempotency as never,
      });

      const res = await gate.acquireIdempotency('cancel_order', { orderId: '102' });
      expect(res.success).toBe(true);
      expect(res.key).toBe('idemp-key-102');
      expect(mockIdempotency.acquireForTool).toHaveBeenCalledWith({
        userId: 'user-1',
        provider: 'sql_server',
        toolName: 'cancel_order',
        args: { orderId: '102' },
      });

      await gate.completeIdempotency('idemp-key-102', { ok: true });
      expect(mockIdempotency.complete).toHaveBeenCalledWith('idemp-key-102', { ok: true });

      await gate.releaseIdempotency('idemp-key-102');
      expect(mockIdempotency.release).toHaveBeenCalledWith('idemp-key-102');
    });

    it('acquireIdempotency() bypasses IdempotencyManager hoàn toàn cho các tool Read-only / Query', async () => {
      const mockIdempotency = {
        acquireForTool: jest.fn(),
      };

      const gate = new ToolRiskGate({
        dto: baseDto,
        mcpTools: [],
        strategy: createStrategy(),
        model: 'gemini-2.0-flash',
        circuitBreaker,
        logger,
        signal: new AbortController().signal,
        insertAccumulator: new InsertAccumulator(),
        idempotencyManager: mockIdempotency as never,
      });

      const resFind = await gate.acquireIdempotency('find_customer', { name: 'Nam' });
      expect(resFind.success).toBe(true);
      expect(mockIdempotency.acquireForTool).not.toHaveBeenCalled();

      const resRead = await gate.acquireIdempotency('google_sheets.read_range', { range: 'A1:B2' });
      expect(resRead.success).toBe(true);
      expect(mockIdempotency.acquireForTool).not.toHaveBeenCalled();
    });
  });
});
