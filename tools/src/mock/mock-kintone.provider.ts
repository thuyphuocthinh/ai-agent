import * as fs from 'fs';
import * as path from 'path';
import { McpResourceDto, McpToolDto } from '../contracts';
import { MockProvider, errorResult, jsonResult, textResult, stringArg } from './mock-provider';

export const MOCK_KINTONE_PROVIDER_ID = 'kintone';

const TOOLS: McpToolDto[] = [
  {
    name: 'get_customers',
    description:
      'Lấy toàn bộ danh sách khách hàng doanh nghiệp và chi tiết hợp đồng lớn trong hệ thống CRM Kintone (payload lớn > 500KB).',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Số lượng bản ghi cần lấy (mặc định toàn bộ)' },
      },
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'find_customer',
    description:
      'Tìm kiếm hồ sơ khách hàng Kintone CRM theo họ tên hoặc mã khách hàng cụ thể.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Họ tên khách hàng cần tìm (ví dụ: Nguyễn Văn Nam)' },
        customerId: {
          type: 'string',
          description: 'Mã khách hàng chính xác (ví dụ: KH-001, KH-002) khi đã xác định rõ danh tính',
        },
      },
      required: ['name'],
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'query_kintone',
    description:
      'Chạy truy vấn SQL/KQL trích xuất dữ liệu chi tiết khách hàng và báo cáo doanh thu.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Câu lệnh truy vấn (ví dụ: SELECT id, full_name FROM customers)' },
      },
      required: ['query'],
    },
    annotations: { readOnlyHint: true },
  },
];

const RESOURCE: McpResourceDto = {
  uri: 'mock://kintone/schema',
  name: 'Kintone CRM Schema',
  description: 'Schema bảng khách hàng CRM Kintone (fields: id, full_name, email, Customer_Tier, Orders_Subtable)',
  mimeType: 'text/plain',
};

export function createMockKintoneProvider(): MockProvider {
  let cachedLargePayload: unknown = null;

  const loadLargeDataset = () => {
    if (cachedLargePayload) return cachedLargePayload;
    try {
      const candidates = [
        path.resolve(__dirname, '../../../core/src/tests/evals/datasets/enterprise-cross-system-mapping.dataset.json'),
        path.resolve(process.cwd(), 'core/src/tests/evals/datasets/enterprise-cross-system-mapping.dataset.json'),
      ];
      for (const p of candidates) {
        if (fs.existsSync(p)) {
          const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
          if (raw.largeKintoneBulkPayload) {
            cachedLargePayload = raw.largeKintoneBulkPayload;
            return cachedLargePayload;
          }
        }
      }
    } catch {
      // Fallback nếu không đọc được file
    }
    return [
      { id: '10001', company: 'Tập đoàn Công nghệ Alpha Tech', tier: 'VIP_PLATINUM' },
    ];
  };

  return {
    id: MOCK_KINTONE_PROVIDER_ID,
    tools: TOOLS,
    resources: [{ dto: RESOURCE, read: () => 'Kintone CRM: Bảng customers (id, full_name, email, Customer_Tier)' }],
    call(name: string, args: Record<string, unknown>) {
      if (name === 'get_customers') {
        const data = loadLargeDataset();
        return jsonResult(data);
      }

      if (name === 'find_customer') {
        const queryName = (stringArg(args, 'name') || '').toLowerCase();
        const customerId = stringArg(args, 'customerId') || stringArg(args, 'id');

        if (customerId === 'KH-001') {
          return jsonResult({
            id: 'KH-001',
            fullName: 'Nguyễn Văn Nam (Hà Nội)',
            phone: '0912***888',
            tier: 'VIP_GOLD',
            totalOrders: 15,
            totalSpent: 450000000,
            address: 'Tầng 12, Keangnam Landmark 72, Cầu Giấy, Hà Nội',
            status: 'ACTIVE',
          });
        }
        if (customerId === 'KH-002') {
          return jsonResult({
            id: 'KH-002',
            fullName: 'Nguyễn Văn Nam (TP.HCM)',
            phone: '0988***333',
            tier: 'STANDARD',
            totalOrders: 1,
            totalSpent: 15000000,
            address: 'Số 45 Lê Duẩn, Quận 1, TP. Hồ Chí Minh',
            status: 'NEW_CUSTOMER',
          });
        }

        // Nếu tìm kiếm tên Nam mà chưa có customerId -> Kích hoạt Clarification HITL
        if (queryName.includes('nam')) {
          const err = new Error(
            'Tìm thấy 2 khách hàng tên Nguyễn Văn Nam trong Kintone CRM. Bạn muốn chọn khách hàng nào?',
          );
          err.name = 'ClarificationRequiredError';
          (err as unknown as { candidates: unknown[] }).candidates = [
            {
              id: 'KH-001',
              label: 'Nguyễn Văn Nam (Hà Nội)',
              description: 'SĐT: 0912***888 - Khách hàng VIP Gold (450.000.000 VNĐ)',
            },
            {
              id: 'KH-002',
              label: 'Nguyễn Văn Nam (TP.HCM)',
              description: 'SĐT: 0988***333 - Khách hàng Mới (15.000.000 VNĐ)',
            },
          ];
          throw err;
        }

        return jsonResult({
          status: 'not_found',
          message: `Không tìm thấy khách hàng nào khớp với tên "${args.name}".`,
        });
      }

      if (name === 'query_kintone') {
        const q = stringArg(args, 'query') || '';
        if (q.includes('user_fullname')) {
          return errorResult(
            'QueryFailedError: column "user_fullname" does not exist in table "customers". Hint: Did you mean "full_name"?',
          );
        }
        return jsonResult([
          {
            id: '10001',
            full_name: 'Nguyễn Văn Nam',
            email: 'nam.nguyen@enterprise.vn',
            tier: 'VIP_PLATINUM',
            status: 'SUCCESS',
          },
        ]);
      }

      return errorResult(`Tool ${name} chưa được hỗ trợ`);
    },
  };
}
