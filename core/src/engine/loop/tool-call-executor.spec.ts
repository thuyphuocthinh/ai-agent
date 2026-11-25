import { Logger } from '@nestjs/common';
import {
  ORCHESTRATION_CONSTANTS,
  EStepExecutionStatus,
} from '@agent/core/constants';
import { ToolCallExecutor } from './tool-call-executor';
import { ToolRepeatGuard } from './guards/tool-repeat-guard';
import { InsertAccumulator } from './guards/insert-accumulator';
import { ToolRiskGate } from './guards/tool-risk-gate';
import { ApprovalRequiredError } from './errors/approval-required.error';
import { RunReactLoopRequestDto } from '../../contracts/dtos/react-loop.dto';
import { McpToolDto } from '../../contracts/dtos/mcp.dto';

// @agent/core/common barrel transitively kéo theo "nanoid" (ESM-only) qua
// string.util.ts — jest không transform được, mock thẳng theo đúng convention
// đã dùng ở react-loop.service.spec.ts thay vì để jest parse cả barrel thật.
jest.mock('@agent/core/common', () => ({
  extractTextFromMcpResult: jest.fn(
    (result?: { content?: { type: string; text?: string }[] }) => {
      if (!result?.content?.length) return '';
      return result.content
        .filter((c) => c.type === 'text' && c.text)
        .map((c) => c.text)
        .join('\n');
    },
  ),
}));

describe('ToolCallExecutor', () => {
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

  const mockMcpClient = { callTool: jest.fn() };
  const mockAgentStream = { emitStep: jest.fn() };
  const mockMemoryManager = {
    buildBudget: jest.fn().mockReturnValue({ toolResultCharBudget: 100_000 }),
  };
  const logger = { log: jest.fn(), warn: jest.fn() } as unknown as Logger;

  function createExecutor(
    options: {
      dto?: RunReactLoopRequestDto;
      mcpTools?: McpToolDto[];
      riskGate?: Partial<ToolRiskGate>;
      insertAccumulator?: InsertAccumulator;
      tmpManager?: any;
    } = {},
  ) {
    const riskGate = {
      isDestructive: jest.fn().mockReturnValue(false),
      isAutoApprovableInsert: jest.fn().mockReturnValue(false),
      checkBulkInsertShortfall: jest.fn().mockResolvedValue(null),
      clearAccumulatorFor: jest.fn(),
      ...options.riskGate,
    } as unknown as ToolRiskGate;

    const executor = new ToolCallExecutor(
      {
        dto: options.dto ?? baseDto,
        mcpTools: options.mcpTools ?? [],
        reactModelId: 'gemini-2.0-flash',
        signal: new AbortController().signal,
      },
      {
        mcpClient: mockMcpClient as any,
        agentStream: mockAgentStream as any,
        memoryManager: mockMemoryManager as any,
        logger,
        repeatGuard: new ToolRepeatGuard(),
        insertAccumulator: options.insertAccumulator ?? new InsertAccumulator(),
        riskGate,
        tmpManager: options.tmpManager,
      },
    );
    return { executor, riskGate };
  }

  beforeEach(() => {
    mockMcpClient.callTool.mockResolvedValue({
      content: [{ type: 'text', text: 'result data' }],
      isError: false,
    });
    mockAgentStream.emitStep.mockResolvedValue(undefined);
  });

  afterEach(() => jest.clearAllMocks());

  it('runs independent tool calls (khác tên/tham số) trong CÙNG 1 lượt CONCURRENTLY', async () => {
    const { executor } = createExecutor();
    let activeCalls = 0;
    let maxConcurrent = 0;
    mockMcpClient.callTool.mockImplementation(async () => {
      activeCalls++;
      maxConcurrent = Math.max(maxConcurrent, activeCalls);
      await new Promise((resolve) => setTimeout(resolve, 20));
      activeCalls--;
      return { content: [{ type: 'text', text: 'data' }], isError: false };
    });

    await executor.run([
      { name: 'get_table1', args: {} },
      { name: 'get_table2', args: {} },
    ]);

    expect(maxConcurrent).toBe(2);
  });

  it('gộp nhiều INSERT cùng bảng+cột TRƯỚC KHI emit/call MCP, nhưng vẫn trả đủ tool_call_id', async () => {
    const insertAccumulator = new InsertAccumulator();
    const { executor } = createExecutor({
      insertAccumulator,
      riskGate: {
        isDestructive: jest.fn().mockReturnValue(true),
        isAutoApprovableInsert: jest.fn().mockReturnValue(true),
      },
    });
    const results = await executor.run([
      {
        id: 'call-a',
        name: 'execute_write_query',
        args: { query: "INSERT INTO Products (Name) VALUES ('A')" },
      },
      {
        id: 'call-b',
        name: 'execute_write_query',
        args: { query: "INSERT INTO Products (Name) VALUES ('B')" },
      },
    ]);

    expect(mockMcpClient.callTool).toHaveBeenCalledTimes(1);
    expect(mockMcpClient.callTool).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'execute_write_query',
        args: {
          query: "INSERT INTO Products (Name) VALUES ('A'), ('B')",
        },
      }),
      expect.anything(),
    );
    expect(mockAgentStream.emitStep).toHaveBeenCalledTimes(2);
    expect(executor.getToolCalls()).toHaveLength(1);
    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({ id: 'call-a', content: 'result data' });
    expect(results[1]).toMatchObject({ id: 'call-b' });
    expect(results[1].content).toContain('no separate database execution');
  });

  it('không gộp INSERT khác bảng hoặc khác danh sách cột', async () => {
    const { executor } = createExecutor();

    await executor.run([
      {
        name: 'execute_write_query',
        args: { query: "INSERT INTO Products (Name) VALUES ('A')" },
      },
      {
        name: 'execute_write_query',
        args: { query: "INSERT INTO Orders (Name) VALUES ('B')" },
      },
      {
        name: 'execute_write_query',
        args: { query: "INSERT INTO Products (Name, Price) VALUES ('C', 10)" },
      },
    ]);

    expect(mockMcpClient.callTool).toHaveBeenCalledTimes(3);
    expect(executor.getToolCalls()).toHaveLength(3);
  });

  it('gộp cả tuple từ một multi-row INSERT với các INSERT cùng batch', async () => {
    const { executor } = createExecutor();

    await executor.run([
      {
        name: 'execute_write_query',
        args: { query: "INSERT INTO Products (Name) VALUES ('A'), ('B')" },
      },
      {
        name: 'execute_write_query',
        args: { query: "INSERT INTO Products (Name) VALUES ('C')" },
      },
    ]);

    expect(mockMcpClient.callTool).toHaveBeenCalledTimes(1);
    expect(mockMcpClient.callTool).toHaveBeenCalledWith(
      expect.objectContaining({
        args: {
          query: "INSERT INTO Products (Name) VALUES ('A'), ('B'), ('C')",
        },
      }),
      expect.anything(),
    );
  });

  it('phục vụ lần gọi lặp lại ĐÚNG tham số từ cache thay vì gọi tool thật lần 2', async () => {
    const { executor } = createExecutor();

    await executor.run([
      { name: 'get_database_schema', args: { x: 1 } },
      { name: 'get_database_schema', args: { x: 1 } },
    ]);

    expect(mockMcpClient.callTool).toHaveBeenCalledTimes(1);
    expect(executor.getToolCalls().every((tc) => tc.status === 'success')).toBe(
      true,
    );
  });

  it('chặn lần gọi lặp lại (không cache vì lần đầu lỗi) sau khi vượt MAX_SAME_TOOL_CALL_REPEATS', async () => {
    mockMcpClient.callTool.mockResolvedValue({
      content: [{ type: 'text', text: 'HTTP 500 upstream error' }],
      isError: true,
    });
    const { executor } = createExecutor();

    await executor.run([{ name: 'get_database_schema', args: { x: 1 } }]);
    await executor.run([{ name: 'get_database_schema', args: { x: 1 } }]);

    expect(mockMcpClient.callTool).toHaveBeenCalledTimes(1);
    const blocked = executor.getToolCalls()[1];
    expect(blocked.status).toBe('error');
    expect(blocked.resultPreview).toContain('đã được gọi với ĐÚNG tham số này');
  });

  it('lần gọi bị chặn vẫn emit tool_call (kèm input) TRƯỚC tool_result, cùng toolCallId', async () => {
    mockMcpClient.callTool.mockResolvedValue({
      content: [{ type: 'text', text: 'no such column' }],
      isError: true,
    });
    const { executor } = createExecutor();
    const args = { query: 'SELECT total_amount FROM orders' };

    await executor.run([{ name: 'read_query', args }]);
    mockAgentStream.emitStep.mockClear();
    await executor.run([{ name: 'read_query', args }]);

    const steps = mockAgentStream.emitStep.mock.calls.map((call) => call[1]);
    expect(steps.map((s) => s.type)).toEqual(['tool_call', 'tool_result']);
    expect(steps[0].argsPreview).toContain('total_amount');
    expect(steps[0].toolCallId).toBe(steps[1].toolCallId);
    expect(steps[1].resultPreview).toContain('đã được gọi với ĐÚNG tham số này');
  });

  it('tự thử lại NGẦM lỗi tạm thời (retryable), thành công ở lần 2 mà không lộ lần lỗi đầu ra ngoài', async () => {
    jest.useFakeTimers();
    mockMcpClient.callTool
      .mockResolvedValueOnce({
        content: [
          {
            type: 'text',
            text: JSON.stringify({ error: true, retryable: true }),
          },
        ],
        isError: true,
      })
      .mockResolvedValueOnce({
        content: [{ type: 'text', text: 'result data' }],
        isError: false,
      });
    const { executor } = createExecutor();

    const runPromise = executor.run([
      { name: 'get_database_schema', args: {} },
    ]);
    await jest.advanceTimersByTimeAsync(
      ORCHESTRATION_CONSTANTS.TRANSIENT_RETRY_BACKOFF_MS + 100,
    );
    await runPromise;

    expect(mockMcpClient.callTool).toHaveBeenCalledTimes(2);
    expect(executor.getToolCalls()).toHaveLength(1);
    expect(executor.getToolCalls()[0].status).toBe('success');
    jest.useRealTimers();
  });

  it('scrubs PII/secrets khỏi exception message trước khi ghi trace/trả về', async () => {
    const rawToken =
      'eyJhbGciOiJIUzI1NiIsInR5cCI.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';
    mockMcpClient.callTool.mockRejectedValueOnce(
      new Error(`Unauthorized, request had header: ${rawToken}`),
    );
    const { executor } = createExecutor();

    const [result] = await executor.run([
      { name: 'get_database_schema', args: {} },
    ]);

    expect(result.content).not.toContain(rawToken);
    expect(executor.getToolCalls()[0].resultPreview).not.toContain(rawToken);
    expect(executor.getToolCalls()[0].resultPreview).toContain(
      '[JWT_TOKEN_REDACTED]',
    );
  });

  describe('Risk Gate delegation (ToolCallExecutor <- ToolRiskGate)', () => {
    it('khi checkBulkInsertShortfall() trả message: ghi lỗi vào trace và KHÔNG gọi tool thật', async () => {
      const { executor, riskGate } = createExecutor({
        riskGate: {
          isDestructive: jest.fn().mockReturnValue(true),
          checkBulkInsertShortfall: jest
            .fn()
            .mockResolvedValue('Đã ghi nhận 1/5 dòng yêu cầu.'),
        },
      });

      const [result] = await executor.run([
        {
          name: 'execute_write_query',
          args: { query: "INSERT INTO Products (Name) VALUES ('A')" },
        },
      ]);

      expect(mockMcpClient.callTool).not.toHaveBeenCalled();
      expect(result.content).toBe('Đã ghi nhận 1/5 dòng yêu cầu.');
      expect(executor.getToolCalls()[0].status).toBe(
        EStepExecutionStatus.ERROR,
      );
      expect(riskGate.isAutoApprovableInsert).not.toHaveBeenCalled();

      const steps = mockAgentStream.emitStep.mock.calls.map((call) => call[1]);
      expect(steps.map((s) => s.type)).toEqual(['tool_call', 'tool_result']);
      expect(steps[0].argsPreview).toContain('INSERT INTO Products');
      expect(steps[0].toolCallId).toBe(steps[1].toolCallId);
    });

    it('khi isAutoApprovableInsert() trả true: tự chạy tool thật rồi clearAccumulatorFor() câu lệnh đã dùng', async () => {
      const { executor, riskGate } = createExecutor({
        riskGate: {
          isDestructive: jest.fn().mockReturnValue(true),
          isAutoApprovableInsert: jest.fn().mockReturnValue(true),
        },
      });
      const query = "INSERT INTO Products (Name) VALUES ('A')";

      await executor.run([{ name: 'execute_write_query', args: { query } }]);

      expect(mockMcpClient.callTool).toHaveBeenCalledTimes(1);
      expect(riskGate.clearAccumulatorFor).toHaveBeenCalledWith(query);
      expect(executor.getToolCalls()[0].status).toBe('success');
    });

    it('khi không shortfall và không auto-approve: throw ApprovalRequiredError, KHÔNG gọi tool thật', async () => {
      const { executor } = createExecutor({
        riskGate: { isDestructive: jest.fn().mockReturnValue(true) },
      });

      await expect(
        executor.run([
          {
            name: 'execute_write_query',
            args: { query: "UPDATE Orders SET Status='Done' WHERE Id=1" },
          },
        ]),
      ).rejects.toThrow(ApprovalRequiredError);
      expect(mockMcpClient.callTool).not.toHaveBeenCalled();
    });

    it('emits friendlySummary and scrubs PII in argsPreview and resultPreview (AC-9)', async () => {
      mockMcpClient.callTool.mockResolvedValue({
        content: [{ type: 'text', text: 'secret credit_card: 4111-2222-3333-4444' }],
        isError: false,
      });
      const { executor } = createExecutor();
      const args = {
        query: 'SELECT id, price FROM products WHERE category = "electronics"',
        password: 'my-super-secret-password',
      };

      await executor.run([{ name: 'execute_read_query', args }]);

      const steps = mockAgentStream.emitStep.mock.calls.map((call) => call[1]);
      expect(steps).toHaveLength(2);
      expect(steps[0].type).toBe('tool_call');
      expect(steps[0].friendlySummary).toBe('Tra cứu dữ liệu từ bảng "products"');
      expect(steps[0].argsPreview).not.toContain('my-super-secret-password');
      expect(steps[1].type).toBe('tool_result');
      expect(steps[1].friendlySummary).toBe('Tra cứu dữ liệu từ bảng "products"');
    });

    it('appends self-healing recovery hint on first failure and triggers fail-fast on second consecutive failure', async () => {
      mockMcpClient.callTool.mockResolvedValue({
        content: [{ type: 'text', text: 'Table "invalid_tbl" does not exist' }],
        isError: true,
      });
      const { executor } = createExecutor();

      // Lần 1: Lỗi đầu tiên -> Gợi ý tự sửa lỗi qua ToolFailureReflector
      const result1 = await executor.run([
        { id: 'call-1', name: 'execute_read_query', args: { query: 'SELECT * FROM invalid_tbl' } },
      ]);
      expect(result1[0].content).toContain('[LỖI CÔNG CỤ "sql_server.execute_read_query"]:');
      expect(result1[0].content).toContain('--- [HỆ THỐNG PHẢN XẠ & CHẨN ĐOÁN LỖI CÔNG CỤ] ---');
      expect(result1[0].content).toContain('Chỉ dẫn tự sửa (Actionable Guidance):');
      expect(result1[0].content).not.toContain('[FAIL-FAST - NGỪNG THỬ LẠI]');

      // Lần 2: Lỗi tiếp trên cùng tool (khác args nên không bị ToolRepeatGuard chặn) -> Kích hoạt Fail-Fast
      const result2 = await executor.run([
        { id: 'call-2', name: 'execute_read_query', args: { query: 'SELECT * FROM invalid_tbl_2' } },
      ]);
      expect(result2[0].content).toContain('[FAIL-FAST - NGỪNG THỬ LẠI]');
      expect(result2[0].content).toContain('đã thất bại liên tiếp 2 lần');
      expect(result2[0].content).toContain('Không tiếp tục gọi lại công cụ này nữa');
    });

    it('offloads huge JSON results (> 50KB) to disk and returns lightweight envelope to save tokens', async () => {
      const records = Array.from({ length: 1500 }, (_, i) => ({
        id: i + 1,
        code: `ORD-${i + 1}`,
        customer: `Khách hàng ${i + 1}`,
        total: 1500000,
      }));
      const rawJson = JSON.stringify(records);
      expect(rawJson.length).toBeGreaterThan(ORCHESTRATION_CONSTANTS.DIRECT_TO_DISK_CHAR_THRESHOLD);

      const mockTmpManager = {
        saveJsonToFile: jest.fn().mockResolvedValue('/tmp/artifacts/reply-msg-1/source_query_orders.json'),
      };

      mockMcpClient.callTool.mockResolvedValue({
        content: [{ type: 'text', text: rawJson }],
        isError: false,
      });

      const { executor } = createExecutor({ tmpManager: mockTmpManager });
      const result = await executor.run([
        { id: 'call-1', name: 'query_orders', args: { limit: 1500 } },
      ]);

      expect(mockTmpManager.saveJsonToFile).toHaveBeenCalledWith(
        'reply-msg-1',
        'source_query_orders.json',
        records,
      );

      const envelope = JSON.parse(result[0].content);
      expect(envelope).toMatchObject({
        status: 'saved_to_tmp',
        path: '/tmp/artifacts/reply-msg-1/source_query_orders.json',
        recordCount: 1500,
        sample: [records[0], records[1]],
      });
      expect(envelope.note).toContain('Python Compute Sandbox');
    });
  });
});
