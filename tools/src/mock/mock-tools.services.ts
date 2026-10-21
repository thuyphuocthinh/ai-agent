import { Injectable } from '@nestjs/common';
import {
  CallToolRequestDto,
  CallToolResponseDto,
  McpToolDto,
} from '@agent/core/dto/mcp.dto';
import {
  MockQueryResult,
  createMockDatabase,
  describeMockSchema,
  runMockRead,
  runMockWrite,
} from './mock-sql.dataset';

export const MOCK_PROVIDER_ID = 'sql_server';

const QUERY_SCHEMA = {
  type: 'object',
  properties: { query: { type: 'string', description: 'Câu lệnh SQL' } },
  required: ['query'],
};

const MOCK_TOOLS: McpToolDto[] = [
  {
    name: 'table_schema',
    description: 'Xem cấu trúc các bảng (products, orders, payments) hoặc 1 bảng cụ thể.',
    inputSchema: {
      type: 'object',
      properties: { table: { type: 'string', description: 'Tên bảng (bỏ trống = tất cả)' } },
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'read_query',
    description:
      'Chạy 1 câu SELECT chỉ đọc (SQLite: JOIN, GROUP BY, CASE, COUNT/SUM... đều dùng được) trên dữ liệu mẫu (products, orders, payments).',
    inputSchema: QUERY_SCHEMA,
    annotations: { readOnlyHint: true },
  },
  {
    name: 'execute_write_query',
    description:
      'Chạy câu lệnh GHI (INSERT/UPDATE/DELETE) trên dữ liệu mẫu. Cần người dùng duyệt trước khi chạy.',
    inputSchema: QUERY_SCHEMA,
    annotations: { destructiveHint: true },
  },
];

const toResponse = (result: MockQueryResult): CallToolResponseDto => ({
  content: [{ type: 'text', text: result.ok ? result.text : result.error }],
  isError: !result.ok,
});
const fail = (error: string): CallToolResponseDto => toResponse({ ok: false, error });

/**
 * Thay McpClientService khi MOCK_TOOLS=true: 1 agent `sql_server` giả chạy trên
 * SQLite thật trong bộ nhớ với dữ liệu mẫu, không gọi mạng. Chỉ để test
 * engine/playground khi chưa có MCP thật. Lệnh ghi được áp dụng vào DB trong bộ
 * nhớ (đọc lại thấy thay đổi) và mất khi khởi động lại.
 */
@Injectable()
export class MockMcpClientService {
  private readonly db = createMockDatabase();

  async getTools(provider: string): Promise<McpToolDto[]> {
    return provider === MOCK_PROVIDER_ID ? MOCK_TOOLS : [];
  }

  async getResources(): Promise<never[]> {
    return [];
  }

  async readResource(): Promise<string> {
    return '';
  }

  async callTool(dto: CallToolRequestDto): Promise<CallToolResponseDto> {
    if (dto.provider !== undefined && dto.provider !== MOCK_PROVIDER_ID) {
      return fail(`Provider "${dto.provider}" không có trong chế độ mock`);
    }
    const query = typeof dto.args?.query === 'string' ? dto.args.query : '';

    switch (dto.name) {
      case 'table_schema': {
        const table = typeof dto.args?.table === 'string' ? dto.args.table : undefined;
        return toResponse(describeMockSchema(this.db, table));
      }
      case 'read_query':
        return query ? toResponse(runMockRead(this.db, query)) : fail('Thiếu tham số "query"');
      case 'execute_write_query':
        return query ? toResponse(runMockWrite(this.db, query)) : fail('Thiếu tham số "query"');
      default:
        return fail(`Tool "${dto.name}" không tồn tại trong chế độ mock`);
    }
  }
}

/** Thay McpAuthClientService khi MOCK_TOOLS=true: provider giả luôn "đã kết nối". */
@Injectable()
export class MockMcpAuthClientService {
  async getConnectionStatus() {
    return [
      {
        provider_id: MOCK_PROVIDER_ID,
        is_connected: true,
        status: 'connected',
        connected_at: null,
      },
    ];
  }
}
