import { PrismaMessageSink } from './prisma-message-sink';
import { PrismaService } from '../prisma.service';
import { EMessageRole, EStepExecutionStatus } from '@agent/core/constants';
import { MessageRole, Prisma } from '@prisma/client';
import { DatabaseOperationException } from '../../../common/errors';

describe('PrismaMessageSink', () => {
  let sink: PrismaMessageSink;
  let mockPrisma: {
    user: { upsert: jest.Mock };
    conversation: { upsert: jest.Mock };
    conversationMessage: {
      create: jest.Mock;
      findUnique: jest.Mock;
      findMany: jest.Mock;
      update: jest.Mock;
    };
  };

  beforeEach(() => {
    mockPrisma = {
      user: {
        upsert: jest.fn().mockResolvedValue({ id: 'usr_admin_default' }),
      },
      conversation: {
        upsert: jest.fn().mockResolvedValue({ id: 'conv-123' }),
      },
      conversationMessage: {
        create: jest.fn().mockResolvedValue({ id: 'msg-created' }),
        findUnique: jest.fn(),
        findMany: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
      },
    };

    sink = new PrismaMessageSink(mockPrisma as unknown as PrismaService);
  });

  describe('createMessage & addUserMessage', () => {
    it('lưu tin nhắn của USER vào CSDL và phát thông báo event', async () => {
      const listener = jest.fn();
      sink.onMessage(listener);

      const res = await sink.addUserMessage({
        conversationId: 'conv-123',
        text: 'Xin chào AI Agent!',
      });

      expect(res.id).toBeDefined();
      expect(mockPrisma.conversationMessage.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            conversationId: 'conv-123',
            role: MessageRole.USER,
            text: 'Xin chào AI Agent!',
            isText: true,
          }),
        }),
      );
      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'created',
          role: EMessageRole.USER,
          content: 'Xin chào AI Agent!',
        }),
      );
    });

    it('lưu tin nhắn của ASSISTANT (MODEL) vào CSDL', async () => {
      const res = await sink.createMessage({
        conversationId: 'conv-123',
        content: 'Tôi là trợ lý AI.',
      });

      expect(res.id).toBeDefined();
      expect(mockPrisma.conversationMessage.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            conversationId: 'conv-123',
            role: MessageRole.ASSISTANT,
            text: 'Tôi là trợ lý AI.',
            isText: true,
          }),
        }),
      );
    });
  });

  describe('updateMessage', () => {
    it('cập nhật nội dung kèm toolCalls, persona và latency vào metadata', async () => {
      mockPrisma.conversationMessage.findUnique.mockResolvedValue({
        id: 'msg-target',
        conversationId: 'conv-123',
        role: MessageRole.ASSISTANT,
        metadata: { initialKey: 'initialVal' },
      });

      await sink.updateMessage({
        id: 'msg-target',
        content: 'Nội dung cập nhật',
        executionTimeMs: 450,
        toolCalls: [
          {
            tool: 'read_query',
            status: EStepExecutionStatus.COMPLETED,
            resultPreview: '10 rows',
          },
        ],
        persona: {
          role: 'Data Analyst',
          goal: 'Truy vấn cơ sở dữ liệu',
        },
        steps: [
          {
            agent: 'sql_server',
            task: 'Truy vấn dữ liệu',
            toolCalls: [
              {
                tool: 'read_query',
                status: EStepExecutionStatus.COMPLETED,
                resultPreview: '10 rows',
              },
            ],
          },
        ],
      });

      expect(mockPrisma.conversationMessage.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'msg-target' },
          data: expect.objectContaining({
            text: 'Nội dung cập nhật',
            latencyMs: 450,
            metadata: expect.objectContaining({
              initialKey: 'initialVal',
              executionTimeMs: 450,
              toolCalls: expect.arrayContaining([
                expect.objectContaining({ tool: 'read_query' }),
              ]),
              steps: expect.arrayContaining([
                expect.objectContaining({ agent: 'sql_server' }),
              ]),
              persona: expect.objectContaining({
                role: 'Data Analyst',
                goal: 'Truy vấn cơ sở dữ liệu',
              }),
            }),
          }),
        }),
      );
    });
  });

  describe('updateMessage — routing (card Supervisor sau reload)', () => {
    const existing = {
      id: 'msg-target',
      conversationId: 'conv-123',
      role: MessageRole.ASSISTANT,
      metadata: { initialKey: 'initialVal' },
    };

    it('lưu routing vào metadata, giữ nguyên metadata cũ', async () => {
      mockPrisma.conversationMessage.findUnique.mockResolvedValue(existing);

      await sink.updateMessage({
        id: 'msg-target',
        content: 'xong',
        routing: { mode: 'workflow', label: 'Quy trình nhập hàng' },
      });

      expect(mockPrisma.conversationMessage.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            metadata: expect.objectContaining({
              initialKey: 'initialVal',
              routing: { mode: 'workflow', label: 'Quy trình nhập hàng' },
            }),
          }),
        }),
      );
    });

    it('cập nhật không kèm routing (VD turn resume) thì KHÔNG xoá routing đã lưu', async () => {
      mockPrisma.conversationMessage.findUnique.mockResolvedValue({
        ...existing,
        metadata: { routing: { mode: 'single_agent' } },
      });

      await sink.updateMessage({ id: 'msg-target', content: 'cập nhật tiếp' });

      expect(mockPrisma.conversationMessage.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            metadata: expect.objectContaining({ routing: { mode: 'single_agent' } }),
          }),
        }),
      );
    });
  });

  describe('getRecentHistory', () => {
    it('lấy lịch sử hội thoại trước beforeMessageId và giới hạn bởi limit', async () => {
      const now = new Date();
      mockPrisma.conversationMessage.findMany.mockResolvedValue([
        { id: 'm1', role: MessageRole.USER, text: 'Câu 1', metadata: {}, createdAt: now },
        { id: 'm2', role: MessageRole.ASSISTANT, text: 'Đáp 1', metadata: { toolCalls: [] }, createdAt: now },
        { id: 'm3', role: MessageRole.USER, text: 'Câu 2', metadata: {}, createdAt: now },
        { id: 'm4', role: MessageRole.ASSISTANT, text: 'Đáp 2', metadata: {}, createdAt: now },
        { id: 'm5', role: MessageRole.USER, text: 'Câu 3', metadata: {}, createdAt: now },
      ]);

      const history = await sink.getRecentHistory({
        conversationId: 'conv-123',
        userId: 'usr-1',
        beforeMessageId: 'm4',
        limit: 2,
      });

      expect(history).toHaveLength(2);
      expect(history[0]).toEqual({
        id: 'm2',
        role: EMessageRole.MODEL,
        text: 'Đáp 1',
        metadata: { toolCalls: [] },
        createdAt: now,
      });
      expect(history[1]).toEqual({
        id: 'm3',
        role: EMessageRole.USER,
        text: 'Câu 2',
        metadata: {},
        createdAt: now,
      });
    });

    it('lưu và truy vấn attachments trong getRecentHistory', async () => {
      const now = new Date();
      mockPrisma.conversationMessage.findMany.mockResolvedValue([
        {
          id: 'm1',
          role: MessageRole.USER,
          text: 'Xem ảnh',
          attachments: [{ type: 'image', url: 'https://img.com/1.png' }],
          metadata: {},
          createdAt: now,
        },
      ]);

      const history = await sink.getRecentHistory({
        conversationId: 'conv-1',
        userId: 'u1',
        beforeMessageId: '',
        limit: 10,
      });

      expect(history[0].attachments).toEqual([
        { type: 'image', url: 'https://img.com/1.png' },
      ]);
    });
  });

  describe('Bảo mật lỗi (No SQL leak)', () => {
    it('làm sạch ngoại lệ Prisma P2003 và không để lộ chuỗi SQL ra ngoài', async () => {
      const prismaError = new Prisma.PrismaClientKnownRequestError(
        'Foreign key constraint failed on table `conversation_messages` INSERT INTO conversation_messages...',
        {
          code: 'P2003',
          clientVersion: '6.19.3',
        },
      );

      mockPrisma.conversationMessage.create.mockRejectedValue(prismaError);

      await expect(
        sink.addUserMessage({
          conversationId: 'conv-non-existent',
          text: 'test',
        }),
      ).rejects.toThrow(DatabaseOperationException);

      try {
        await sink.addUserMessage({
          conversationId: 'conv-non-existent',
          text: 'test',
        });
      } catch (err: unknown) {
        const error = err as DatabaseOperationException;
        expect(error.code).toBe('FOREIGN_KEY_VIOLATION');
        expect(error.statusCode).toBe(400);
        expect(error.message).not.toContain('INSERT INTO');
        expect(error.message).not.toContain('conversation_messages');
        expect(error.message).toContain('Thao tác không hợp lệ');
      }
    });
  });
});
