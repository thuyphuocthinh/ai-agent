import { ActionSummaryService, formatActionSummary } from './action-summary.service';
import { ActionSummaryAdapter, ActionSummaryContext } from './action-summary.interface';

describe('ActionSummaryService (Ports & Adapters + Policy Engine)', () => {
  let service: ActionSummaryService;

  beforeEach(() => {
    service = new ActionSummaryService();
  });

  describe('SqlSummaryAdapter (Priority 100)', () => {
    it('formats SELECT queries into table read summaries', () => {
      const summary = service.format({
        provider: 'sql_server',
        toolName: 'execute_read_query',
        args: { query: 'SELECT id, name, price FROM products WHERE status = "active"' },
      });
      expect(summary).toBe('Tra cứu dữ liệu từ bảng "products"');
    });

    it('formats UPDATE queries with where conditions', () => {
      const summary = service.format({
        provider: 'sql_server',
        toolName: 'execute_write_query',
        args: { query: 'UPDATE products SET price = 1000 WHERE id = 1' },
      });
      expect(summary).toBe('Cập nhật dữ liệu bảng "products" (điều kiện: id = 1)');
    });

    it('formats DELETE queries with where conditions', () => {
      const summary = service.format({
        provider: 'sql_server',
        toolName: 'execute_write_query',
        args: { query: 'DELETE FROM orders WHERE status = "cancelled"' },
      });
      expect(summary).toBe('Xóa dữ liệu bảng "orders" (điều kiện: status = "cancelled")');
    });

    it('formats INSERT queries with tuple count', () => {
      const summary = service.format({
        provider: 'sql_server',
        toolName: 'execute_write_query',
        args: { query: 'INSERT INTO products (name, price) VALUES ("P1", 100), ("P2", 200)' },
      });
      expect(summary).toBe('Thêm mới 2 dòng vào bảng "products"');
    });

    it('formats TRUNCATE TABLE operations', () => {
      const summary = service.format({
        provider: 'sql_server',
        toolName: 'execute_write_query',
        args: { query: 'TRUNCATE TABLE logs' },
      });
      expect(summary).toBe('TRUNCATE toàn bộ bảng "logs"');
    });

    it('formats table_schema lookups', () => {
      const summary = service.format({
        provider: 'sql_server',
        toolName: 'table_schema',
        args: { table_name: 'customers' },
      });
      expect(summary).toBe('Tra cứu cấu trúc bảng "customers"');
    });

    it('falls back gracefully on non-matching SQL queries', () => {
      const summary = service.format({
        provider: 'sql_server',
        toolName: 'execute_raw_query',
        args: { query: 'EXEC sp_who2' },
      });
      expect(summary).toBe('Thực thi truy vấn cơ sở dữ liệu');
    });
  });

  describe('PolicySummaryAdapter (Priority 50)', () => {
    it('formats GitHub issue creation with interpolated title', () => {
      const summary = service.format({
        provider: 'github',
        toolName: 'create_issue',
        args: { title: 'Fix memory leak' },
      });
      expect(summary).toBe('Tạo issue mới trên GitHub: "Fix memory leak"');
    });

    it('formats Slack message with channel in function template', () => {
      const summary = service.format({
        provider: 'slack',
        toolName: 'send_message',
        args: { channel: 'alerts' },
      });
      expect(summary).toBe('Gửi tin nhắn qua Slack (kênh #alerts)');
    });

    it('formats Google Sheets operations', () => {
      expect(
        service.format({ provider: 'google_sheets', toolName: 'read_sheet' }),
      ).toBe('Đọc dữ liệu bảng tính Google Sheets');
      expect(
        service.format({ provider: 'google_sheets', toolName: 'append_row' }),
      ).toBe('Cập nhật dữ liệu bảng tính Google Sheets');
    });

    it('formats Gmail sending', () => {
      const summary = service.format({
        provider: 'google_mail',
        toolName: 'send_mail',
        args: { to: 'admin@company.com' },
      });
      expect(summary).toBe('Gửi thư qua Gmail tới admin@company.com');
    });

    it('formats Python compute', () => {
      const summary = service.format({
        provider: 'compute',
        toolName: 'execute_python',
      });
      expect(summary).toBe('Thực thi tính toán dữ liệu bằng Python');
    });
  });

  describe('MetadataSummaryAdapter (Priority 10)', () => {
    it('uses tool description when available for arbitrary providers', () => {
      const summary = service.format({
        provider: 'custom_crm',
        toolName: 'fetch_lead_data',
        toolDescription: 'Lấy thông tin khách hàng tiềm năng từ hệ thống CRM. Chi tiết mở rộng.',
      });
      expect(summary).toBe('Lấy thông tin khách hàng tiềm năng từ hệ thống CRM');
    });
  });

  describe('FallbackSummaryAdapter (Priority 0)', () => {
    it('cleans up unknown tool name when no adapter or description matches', () => {
      const summary = service.format({
        provider: 'unknown_service',
        toolName: 'sync_user_preferences',
      });
      expect(summary).toBe('Thực thi tác vụ: sync user preferences');
    });
  });

  describe('Extensibility & Custom Adapter Registration', () => {
    it('allows registering custom adapters with higher priority', () => {
      class HighPriorityCustomAdapter implements ActionSummaryAdapter {
        readonly priority = 200;
        supports(context: ActionSummaryContext): boolean {
          return context.toolName === 'custom_vip_tool';
        }
        format(): string {
          return '⭐ Tác vụ VIP đặc biệt';
        }
      }

      service.register(new HighPriorityCustomAdapter());
      const summary = service.format({
        provider: 'custom',
        toolName: 'custom_vip_tool',
      });
      expect(summary).toBe('⭐ Tác vụ VIP đặc biệt');
    });

    it('falls through to next adapter if an adapter throws an exception', () => {
      class CrashingAdapter implements ActionSummaryAdapter {
        readonly priority = 999;
        supports(): boolean {
          return true;
        }
        format(): string {
          throw new Error('Simulation crash');
        }
      }

      service.register(new CrashingAdapter());
      // Should fall back to lower priority adapters without crashing
      const summary = service.format({
        provider: 'slack',
        toolName: 'send_message',
        args: { channel: 'dev' },
      });
      expect(summary).toBe('Gửi tin nhắn qua Slack (kênh #dev)');
    });
  });

  describe('formatActionSummary helper function', () => {
    it('works as a drop-in static helper', () => {
      const summary = formatActionSummary({
        provider: 'compute',
        toolName: 'execute_python',
      });
      expect(summary).toBe('Thực thi tính toán dữ liệu bằng Python');
    });
  });
});
