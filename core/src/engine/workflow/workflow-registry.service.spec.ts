import { WorkflowRegistryService } from './workflow-registry.service';
import { createWorkflow } from '../../contracts';

describe('WorkflowRegistryService', () => {
  let service: WorkflowRegistryService;

  beforeEach(() => {
    service = new WorkflowRegistryService();
    service.onModuleInit();
  });

  describe('Built-in workflows', () => {
    it('khởi tạo sẵn 2 built-in workflows mặc định khi onModuleInit được gọi', () => {
      const list = service.list();
      expect(list.length).toBeGreaterThanOrEqual(2);

      const ids = list.map((w) => w.id);
      expect(ids).toContain('customer-support');
      expect(ids).toContain('hotel-booking');
    });

    it('customer-support bot có cấu hình công cụ email và yêu cầu duyệt gửi thư', () => {
      const cs = service.get('customer-support');
      expect(cs).toBeDefined();
      expect(cs?.name).toBe('Customer Support Bot');
      expect(cs?.provider).toBe('google_mail');
      expect(cs?.tools).toContain('search_emails');
      expect(cs?.tools).toContain('send_email');
      expect(cs?.requireHumanApprovalFor).toContain('send_email');
    });

    it('hotel-booking assistant có cấu hình công cụ tra cứu cơ sở dữ liệu sql', () => {
      const hb = service.get('hotel-booking');
      expect(hb).toBeDefined();
      expect(hb?.name).toBe('Hotel Booking Assistant');
      expect(hb?.provider).toBe('sql_server');
      expect(hb?.tools).toContain('read_query');
      expect(hb?.tools).toContain('table_schema');
    });
  });

  describe('CRUD operations & Validation', () => {
    it('register() đăng ký workflow mới thành công và list() phản ánh chính xác', () => {
      service.register({
        id: 'devops-reporter',
        name: 'DevOps Reporter',
        description: 'Hỗ trợ kiểm tra pipeline và trạng thái build',
        systemPrompt: 'Bạn là chuyên viên DevOps support.',
        tools: ['check_pipeline', 'trigger_build'],
        provider: 'compute',
      });

      expect(service.has('devops-reporter')).toBe(true);

      const wf = service.get('devops-reporter');
      expect(wf?.name).toBe('DevOps Reporter');
      expect(wf?.tools).toEqual(['check_pipeline', 'trigger_build']);

      const summary = service.list().find((w) => w.id === 'devops-reporter');
      expect(summary).toBeDefined();
      expect(summary?.name).toBe('DevOps Reporter');
    });

    it('has() trả về false cho workflow không tồn tại', () => {
      expect(service.has('non-existent-wf')).toBe(false);
      expect(service.get('non-existent-wf')).toBeUndefined();
    });

    it('ném lỗi nếu đăng ký workflow thiếu id hoặc name hoặc systemPrompt', () => {
      expect(() =>
        service.register({
          id: '',
          name: 'Test',
          systemPrompt: 'prompt',
        }),
      ).toThrow('Workflow id is required');

      expect(() =>
        service.register({
          id: 'test',
          name: '  ',
          systemPrompt: 'prompt',
        }),
      ).toThrow('Workflow name is required');

      expect(() =>
        service.register({
          id: 'test',
          name: 'Test',
          systemPrompt: '',
        }),
      ).toThrow('Workflow systemPrompt is required');
    });

    it('đóng băng (immutable) cấu hình workflow khi đăng ký', () => {
      const raw = {
        id: 'secure-wf',
        name: 'Secure Agent',
        systemPrompt: 'Prompt',
        tools: ['tool_a'],
      };
      service.register(raw);
      const retrieved = service.get('secure-wf');
      expect(Object.isFrozen(retrieved)).toBe(true);
      expect(Object.isFrozen(retrieved?.tools)).toBe(true);
    });
  });
});
