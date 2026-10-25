import { PrismaWorkflowStore } from './prisma-workflow.store';
import { PrismaService } from '../prisma.service';
import { AgentWorkflowConfig } from '../../../contracts';

describe('PrismaWorkflowStore', () => {
  let store: PrismaWorkflowStore;
  let mockPrisma: {
    workflow: {
      upsert: jest.Mock;
      findMany: jest.Mock;
    };
  };

  beforeEach(() => {
    mockPrisma = {
      workflow: {
        upsert: jest.fn().mockResolvedValue({}),
        findMany: jest.fn().mockResolvedValue([]),
      },
    };

    store = new PrismaWorkflowStore(mockPrisma as unknown as PrismaService);
  });

  describe('onModuleInit', () => {
    it('khởi tạo các workflows mặc định vào cache và CSDL', async () => {
      await store.onModuleInit();

      expect(store.has('customer-support')).toBe(true);
      expect(store.has('hotel-booking')).toBe(true);
      expect(store.has('it-helpdesk')).toBe(true);
      expect(store.has('inventory-manager')).toBe(true);
      expect(store.has('team-announcement')).toBe(true);

      expect(mockPrisma.workflow.upsert).toHaveBeenCalled();
    });

    it('nạp thêm workflows tùy biến từ CSDL vào cache', async () => {
      mockPrisma.workflow.findMany.mockResolvedValue([
        {
          id: 'custom-bot-1',
          name: 'Custom HR Bot',
          description: 'Bot nhân sự',
          systemPrompt: 'Bạn là chuyên viên HR',
          model: 'gpt-4o',
          tools: ['query_hr'],
          requireApprovalFor: [],
          maxLoops: 3,
          metadata: { provider: 'custom_hr' },
        },
      ]);

      await store.onModuleInit();

      expect(store.has('custom-bot-1')).toBe(true);
      const wf = store.get('custom-bot-1');
      expect(wf?.name).toBe('Custom HR Bot');
      expect(wf?.provider).toBe('custom_hr');
    });
  });

  describe('register, get, list & has', () => {
    it('đăng ký workflow mới vào cache và đồng bộ tới DB', () => {
      const config: AgentWorkflowConfig = {
        id: 'new-bot',
        name: 'New Bot',
        systemPrompt: 'System prompt',
        tools: ['tool_1'],
      };

      store.register(config);

      expect(store.has('new-bot')).toBe(true);
      const fetched = store.get('new-bot');
      expect(fetched?.name).toBe('New Bot');

      const list = store.list();
      expect(list.some((w) => w.id === 'new-bot')).toBe(true);
    });
  });
});
