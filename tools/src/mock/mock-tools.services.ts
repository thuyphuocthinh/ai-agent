import { Injectable } from '@nestjs/common';
import {
  CallToolRequestDto,
  CallToolResponseDto,
  McpToolDto,
} from '@agent/core/dto/mcp.dto';
import { describeMockSchema, runMockSelect } from './mock-sql.dataset';

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
    description: 'Chạy 1 câu SELECT chỉ đọc trên dữ liệu mẫu (products, orders, payments).',
    inputSchema: QUERY_SCHEMA,
    annotations: { readOnlyHint: true },
  },
  {
    name: 'execute_write_query',
    description: 'Chạy câu lệnh GHI (INSERT/UPDATE/DELETE). Cần người dùng duyệt trước khi chạy.',
    inputSchema: QUERY_SCHEMA,
    annotations: { destructiveHint: true },
  },
];

const WRITE_PATTERN = /^\s*(insert|update|delete)\b/i;

const ok = (text: string): CallToolResponseDto => ({
  content: [{ type: 'text', text }],
  isError: false,
});
const fail = (text: string): CallToolResponseDto => ({
  content: [{ type: 'text', text }],
  isError: true,
});

/**
 * Thay McpClientService khi MOCK_TOOLS=true: 1 agent `sql_server` giả với dữ
 * liệu mẫu cố định, không gọi mạng. Chỉ để test engine/playground khi chưa có
 * MCP thật; lệnh ghi KHÔNG thay đổi dữ liệu (chỉ trả kết quả giả).
 */
@Injectable()
export class MockMcpClientService {
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
        const schema = describeMockSchema(table);
        return schema ? ok(schema) : fail(`Bảng "${table}" không tồn tại`);
      }
      case 'read_query': {
        if (!query) return fail('Thiếu tham số "query"');
        const result = runMockSelect(query);
        return result.ok ? ok(JSON.stringify(result.rows)) : fail(result.error);
      }
      case 'execute_write_query': {
        if (!query) return fail('Thiếu tham số "query"');
        if (!WRITE_PATTERN.test(query)) {
          return fail('execute_write_query chỉ nhận INSERT/UPDATE/DELETE');
        }
        return ok(
          JSON.stringify({ affectedRows: 1, note: 'mock: dữ liệu mẫu không bị thay đổi' }),
        );
      }
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
