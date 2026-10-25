import { WorkflowController } from './workflow.controller';
import { IWorkflowRegistry } from '../../../contracts';

describe('WorkflowController', () => {
  let controller: WorkflowController;
  let registry: jest.Mocked<IWorkflowRegistry>;

  beforeEach(() => {
    registry = {
      register: jest.fn(),
      get: jest.fn(),
      list: jest.fn().mockReturnValue([
        {
          id: 'customer-support',
          name: 'Customer Support Bot',
          description: 'Hỗ trợ khách hàng qua email',
          tools: ['search_emails', 'send_email'],
        },
        {
          id: 'hotel-booking',
          name: 'Hotel Booking Assistant',
          description: 'Tra cứu phòng khách sạn',
          tools: ['table_schema', 'read_query'],
        },
      ]),
      has: jest.fn(),
    };

    controller = new WorkflowController(registry);
  });

  describe('GET /api/workflows', () => {
    it('trả về danh sách workflow tóm tắt (WorkflowSummaryDto[]) từ registry', () => {
      const result = controller.getWorkflows();

      expect(registry.list).toHaveBeenCalledTimes(1);
      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('customer-support');
      expect(result[0].tools).toEqual(['search_emails', 'send_email']);
      expect(result[1].id).toBe('hotel-booking');
    });
  });
});
