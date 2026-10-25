import {
  PrismaChatSessionManager,
  DEFAULT_DEV_USER_ID,
} from './prisma-chat-session.manager';
import { PrismaService } from '../prisma.service';
import { EConversationState } from '../../../contracts';
import { ConversationState, Prisma } from '@prisma/client';
import { DatabaseOperationException } from '../../../common/errors';

describe('PrismaChatSessionManager', () => {
  let manager: PrismaChatSessionManager;
  let mockPrisma: {
    user: { upsert: jest.Mock };
    conversation: {
      findUnique: jest.Mock;
      findMany: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
    };
  };

  beforeEach(() => {
    mockPrisma = {
      user: {
        upsert: jest.fn().mockResolvedValue({
          id: DEFAULT_DEV_USER_ID,
          email: 'admin@local.agent',
          fullName: 'Admin Developer',
          role: 'ADMIN',
        }),
      },
      conversation: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
    };

    manager = new PrismaChatSessionManager(mockPrisma as unknown as PrismaService);
  });

  describe('ensureDefaultUser & getOrCreate', () => {
    it('tự động auto-provisioning user mặc định khi tạo phiên mới', async () => {
      mockPrisma.conversation.findUnique.mockResolvedValue(null);
      mockPrisma.conversation.create.mockResolvedValue({
        id: 'sess-123',
        userId: DEFAULT_DEV_USER_ID,
        workspaceId: 'default',
        botUserId: 'bot_default',
        approvalMessageIds: [],
        state: ConversationState.AI_ACTIVE,
        createdAt: new Date(),
        lastSeenAt: new Date(),
      });

      const session = await manager.getOrCreate('sess-123');

      expect(mockPrisma.user.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: DEFAULT_DEV_USER_ID },
        }),
      );
      expect(session.id).toBe('sess-123');
      expect(session.userId).toBe(DEFAULT_DEV_USER_ID);
      expect(session.state).toBe(EConversationState.AI_ACTIVE);
    });

    it('trả về phiên hiện có nếu đã tồn tại trong CSDL', async () => {
      mockPrisma.conversation.findUnique.mockResolvedValue({
        id: 'sess-existing',
        userId: 'usr_custom_1',
        workspaceId: 'workspace_a',
        botUserId: 'bot_custom',
        approvalMessageIds: ['msg-appr-1'],
        state: ConversationState.HUMAN_TAKEOVER,
        createdAt: new Date(),
        lastSeenAt: new Date(),
      });

      const session = await manager.getOrCreate('sess-existing');

      expect(mockPrisma.conversation.create).not.toHaveBeenCalled();
      expect(session.id).toBe('sess-existing');
      expect(session.userId).toBe('usr_custom_1');
      expect(session.state).toBe(EConversationState.HUMAN_TAKEOVER);
      expect(session.approvalMessageIds.has('msg-appr-1')).toBe(true);
    });
  });

  describe('trackApproval & hasApproval', () => {
    it('ghi nhận message id cần duyệt vào danh sách approvalMessageIds', async () => {
      mockPrisma.conversation.findUnique.mockResolvedValue({
        approvalMessageIds: ['msg-old'],
      });
      mockPrisma.conversation.update.mockResolvedValue({});

      await manager.trackApproval('sess-123', 'msg-new');

      expect(mockPrisma.conversation.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'sess-123' },
          data: expect.objectContaining({
            approvalMessageIds: ['msg-old', 'msg-new'],
          }),
        }),
      );
    });

    it('kiểm tra hasApproval chính xác', async () => {
      mockPrisma.conversation.findUnique.mockResolvedValue({
        approvalMessageIds: ['msg-approved-99'],
      });

      const hasApproved = await manager.hasApproval('sess-123', 'msg-approved-99');
      const hasUnapproved = await manager.hasApproval('sess-123', 'msg-other');

      expect(hasApproved).toBe(true);
      expect(hasUnapproved).toBe(false);
    });
  });

  describe('setConversationState & getConversationState', () => {
    it('cập nhật trạng thái hội thoại và lấy lại chính xác', async () => {
      mockPrisma.conversation.findUnique.mockResolvedValue({
        id: 'sess-123',
        state: ConversationState.HUMAN_TAKEOVER,
        approvalMessageIds: [],
        createdAt: new Date(),
        lastSeenAt: new Date(),
      });
      mockPrisma.conversation.update.mockResolvedValue({});

      await manager.setConversationState('sess-123', EConversationState.HUMAN_TAKEOVER);

      expect(mockPrisma.conversation.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'sess-123' },
          data: expect.objectContaining({
            state: ConversationState.HUMAN_TAKEOVER,
          }),
        }),
      );

      const state = await manager.getConversationState('sess-123');
      expect(state).toBe(EConversationState.HUMAN_TAKEOVER);
    });
  });

  describe('Bảo mật lỗi (No SQL leak)', () => {
    it('làm sạch ngoại lệ Prisma P2002 và không để lộ câu lệnh SQL ra client', async () => {
      const prismaError = new Prisma.PrismaClientKnownRequestError(
        'Unique constraint failed on the fields: (id) SELECT * FROM conversations WHERE id = ...',
        {
          code: 'P2002',
          clientVersion: '6.19.3',
        },
      );

      mockPrisma.conversation.findUnique.mockRejectedValue(prismaError);

      await expect(manager.get('sess-crash')).rejects.toThrow(DatabaseOperationException);

      try {
        await manager.get('sess-crash');
      } catch (err: unknown) {
        const error = err as DatabaseOperationException;
        expect(error.code).toBe('DUPLICATE_RESOURCE');
        expect(error.statusCode).toBe(409);
        expect(error.message).not.toContain('SELECT');
        expect(error.message).not.toContain('conversations');
        expect(error.message).toContain('Dữ liệu yêu cầu đã tồn tại');
      }
    });
  });

  describe('listRecent & updateTitle', () => {
    it('truy vấn danh sách các cuộc hội thoại gần nhất qua phân trang cursor', async () => {
      const mockItems = [
        {
          id: '01a171ed-5764-75bb-b455-73f7e34aed2b',
          title: 'Tra cứu SQL sản phẩm',
          state: ConversationState.AI_ACTIVE,
          lastSeenAt: new Date('2026-10-25T07:19:00Z'),
          createdAt: new Date('2026-10-25T07:19:00Z'),
        },
        {
          id: '01a171ed-5764-75bb-b455-73f7e34aed2a',
          title: 'Chào hỏi trợ lý',
          state: ConversationState.HUMAN_TAKEOVER,
          lastSeenAt: new Date('2026-10-25T07:15:00Z'),
          createdAt: new Date('2026-10-25T07:15:00Z'),
        },
      ];

      mockPrisma.conversation.findMany.mockResolvedValue(mockItems);

      const result = await manager.listRecent({ limit: 10 });

      expect(mockPrisma.user.upsert).toHaveBeenCalled();
      expect(mockPrisma.conversation.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: DEFAULT_DEV_USER_ID },
          take: 11,
        }),
      );
      expect(result.data).toHaveLength(2);
      expect(result.data[0].id).toBe('01a171ed-5764-75bb-b455-73f7e34aed2b');
      expect(result.data[0].title).toBe('Tra cứu SQL sản phẩm');
      expect(result.data[0].state).toBe(EConversationState.AI_ACTIVE);
      expect(result.data[1].state).toBe(EConversationState.HUMAN_TAKEOVER);
      expect(result.meta.hasMore).toBe(false);
    });

    it('cập nhật tiêu đề cuộc trò chuyện khi chuỗi hợp lệ', async () => {
      mockPrisma.conversation.update.mockResolvedValue({});

      await manager.updateTitle('sess-123', '   Tiêu đề mới sau khi cắt khoảng trắng   ');

      expect(mockPrisma.conversation.update).toHaveBeenCalledWith({
        where: { id: 'sess-123' },
        data: { title: 'Tiêu đề mới sau khi cắt khoảng trắng' },
      });
    });

    it('bỏ qua updateTitle nếu chuỗi rỗng', async () => {
      await manager.updateTitle('sess-123', '    ');

      expect(mockPrisma.conversation.update).not.toHaveBeenCalled();
    });
  });
});
