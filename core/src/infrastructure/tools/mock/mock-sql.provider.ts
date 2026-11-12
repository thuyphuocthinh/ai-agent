import { McpResourceDto, McpToolDto } from '../../../contracts/dtos/mcp.dto';
import {
  MockQueryResult,
  createMockDatabase,
  describeMockSchema,
  runMockRead,
  runMockWrite,
} from './mock-sql.dataset';
import { MockProvider, errorResult, textResult } from './mock-provider';

export const MOCK_PROVIDER_ID = 'sql_server';

const QUERY_SCHEMA = {
  type: 'object',
  properties: { query: { type: 'string', description: 'Câu lệnh SQL' } },
  required: ['query'],
};

const TOOLS: McpToolDto[] = [
  {
    name: 'table_schema',
    description: 'Xem cấu trúc các bảng (products, orders, payments, orders_large) hoặc 1 bảng cụ thể.',
    inputSchema: {
      type: 'object',
      properties: { table: { type: 'string', description: 'Tên bảng (bỏ trống = tất cả)' } },
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'read_query',
    description:
      'Chạy 1 câu SELECT chỉ đọc (SQLite: JOIN, GROUP BY, CASE, COUNT/SUM... đều dùng được) trên dữ liệu mẫu (products, orders, payments, orders_large).',
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

// Giống MCP thật: schema đi qua resource để engine nhét vào system prompt của MỌI
// worker (mỗi vòng Supervisor là 1 worker mới), model khỏi phải đoán tên cột.
const SCHEMA_RESOURCE: McpResourceDto = {
  uri: 'mock://sql_server/schema',
  name: 'Database schema',
  description: 'Bảng và cột của dữ liệu mẫu (products, orders, payments, orders_large)',
  mimeType: 'text/plain',
};

const toResult = (result: MockQueryResult) =>
  result.ok ? textResult(result.text) : errorResult(result.error);

/** SQL giả chạy trên SQLite thật trong bộ nhớ; lệnh ghi áp dụng vào DB và mất khi dựng lại. */
export function createMockSqlProvider(): MockProvider {
  const db = createMockDatabase();

  // Sai tên bảng/cột: kèm schema thật vào lỗi để lần sửa kế tiếp của model đúng ngay.
  const withSchemaHint = (result: MockQueryResult): MockQueryResult => {
    if (result.ok || !/no such (column|table)/i.test(result.error)) return result;
    const schema = describeMockSchema(db);
    return schema.ok ? { ok: false, error: `${result.error}\nSchema thật:\n${schema.text}` } : result;
  };

  return {
    id: MOCK_PROVIDER_ID,
    tools: TOOLS,
    resources: [
      {
        dto: SCHEMA_RESOURCE,
        read: () => {
          const schema = describeMockSchema(db);
          return schema.ok ? schema.text : '';
        },
      },
    ],
    call(name, args) {
      const query = typeof args.query === 'string' ? args.query : '';
      if (name === 'table_schema') {
        return toResult(describeMockSchema(db, typeof args.table === 'string' ? args.table : undefined));
      }
      if (!query) return errorResult('Thiếu tham số "query"');
      return toResult(withSchemaHint(name === 'read_query' ? runMockRead(db, query) : runMockWrite(db, query)));
    },
  };
}
