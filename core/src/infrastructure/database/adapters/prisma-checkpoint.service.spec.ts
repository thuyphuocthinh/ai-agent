import { PrismaCheckpointService } from './prisma-checkpoint.service';
import { PrismaService } from '../prisma.service';
import { CheckpointKind, CheckpointStatus, Prisma } from '@prisma/client';
import { DatabaseOperationException } from '../../../common/errors';
import { OrchestrationCheckpointStatus } from '../../../contracts/dtos/checkpoint.dto';

describe('PrismaCheckpointService', () => {
  let service: PrismaCheckpointService;
  let mockPrisma: {
    user: { upsert: jest.Mock };
    conversation: { upsert: jest.Mock };
    checkpoint: {
      create: jest.Mock;
      findFirst: jest.Mock;
      findUnique: jest.Mock;
      findMany: jest.Mock;
      updateMany: jest.Mock;
    };
  };

  beforeEach(() => {
    mockPrisma = {
      user: {
        upsert: jest.fn().mockResolvedValue({ id: 'usr_admin_default' }),
      },
      conversation: {
        upsert: jest.fn().mockResolvedValue({ id: 'conv-123' }),
        findUnique: jest.fn().mockResolvedValue({ approvalMessageIds: [] }),
        update: jest.fn().mockResolvedValue({ id: 'conv-123' }),
      },
      checkpoint: {
        create: jest.fn(),
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        findMany: jest.fn(),
        updateMany: jest.fn(),
      },
    };

    service = new PrismaCheckpointService(mockPrisma as unknown as PrismaService);
  });

  describe('create', () => {
    it('tạo checkpoint an toàn, tự động liên kết user và conversation', async () => {
      const now = new Date();
      mockPrisma.checkpoint.create.mockResolvedValue({
        id: 'cp-1',
        replyMessageId: 'reply-1',
        userId: 'usr_admin_default',
        conversationId: 'conv-123',
        workspaceId: 'default',
        sessionType: 'web',
        originalPrompt: 'Delete table test',
        pendingTool: { name: 'execute_write_query' },
        pendingTask: 'Xóa bảng',
        kind: CheckpointKind.APPROVAL,
        riskLevel: 'high',
        clarificationQuestion: null,
        clarificationCandidates: null,
        selectedProvider: null,
        roundsSoFar: [],
        remainingSteps: [],
        history: [],
        status: CheckpointStatus.PENDING,
        expiresAt: new Date(now.getTime() + 100000),
        executionStartedAt: null,
        toolExecutedAt: null,
        createdAt: now,
        updatedAt: now,
      });

      const res = await service.create({
        replyMessageId: 'reply-1',
        userId: 'usr_admin_default',
        conversationId: 'conv-123',
        originalPrompt: 'Delete table test',
        pendingTask: 'Xóa bảng',
        pendingTool: { provider: 'sql', name: 'execute_write_query', args: {} },
      });

      expect(res.id).toBe('cp-1');
      expect(res.replyMessageId).toBe('reply-1');
      expect(res.status).toBe('pending');
      expect(mockPrisma.user.upsert).toHaveBeenCalled();
      expect(mockPrisma.conversation.upsert).toHaveBeenCalled();
      expect(mockPrisma.checkpoint.create).toHaveBeenCalled();
    });
  });

  describe('claim & claimExecution', () => {
    it('claim thành công khi status là PENDING', async () => {
      mockPrisma.checkpoint.updateMany.mockResolvedValue({ count: 1 });

      const res = await service.claim({
        id: 'cp-1',
        toStatus: OrchestrationCheckpointStatus.APPROVED,
      });

      expect(res.claimed).toBe(true);
      expect(mockPrisma.checkpoint.updateMany).toHaveBeenCalledWith({
        where: { id: 'cp-1', status: CheckpointStatus.PENDING },
        data: expect.objectContaining({ status: CheckpointStatus.APPROVED }),
      });
    });

    it('claim thất bại (claimed=false) nếu checkpoint đã bị worker khác xử lý', async () => {
      mockPrisma.checkpoint.updateMany.mockResolvedValue({ count: 0 });

      const res = await service.claim({
        id: 'cp-1',
        toStatus: OrchestrationCheckpointStatus.APPROVED,
      });

      expect(res.claimed).toBe(false);
    });

    it('claimExecution chỉ thành công 1 lần duy nhất khi executionStartedAt là null', async () => {
      mockPrisma.checkpoint.updateMany.mockResolvedValue({ count: 1 });

      const res = await service.claimExecution({ id: 'cp-1' });

      expect(res.claimed).toBe(true);
      expect(mockPrisma.checkpoint.updateMany).toHaveBeenCalledWith({
        where: { id: 'cp-1', executionStartedAt: null },
        data: expect.objectContaining({ executionStartedAt: expect.any(Date) }),
      });
    });
  });

  describe('markStalledAsRejected & revertApprovedClaim', () => {
    it('đánh dấu checkpoint kẹt thành REJECTED', async () => {
      mockPrisma.checkpoint.updateMany.mockResolvedValue({ count: 1 });

      const res = await service.markStalledAsRejected({ id: 'cp-stalled' });

      expect(res.claimed).toBe(true);
      expect(mockPrisma.checkpoint.updateMany).toHaveBeenCalledWith({
        where: { id: 'cp-stalled', status: CheckpointStatus.APPROVED },
        data: { status: CheckpointStatus.REJECTED },
      });
    });

    it('hoàn nguyên (revert) approved claim về PENDING khi bước sau thất bại', async () => {
      mockPrisma.checkpoint.updateMany.mockResolvedValue({ count: 1 });

      await service.revertApprovedClaim({ id: 'cp-revert' });

      expect(mockPrisma.checkpoint.updateMany).toHaveBeenCalledWith({
        where: { id: 'cp-revert', status: CheckpointStatus.APPROVED },
        data: { status: CheckpointStatus.PENDING },
      });
    });
  });

  describe('Bảo mật lỗi (No SQL leak)', () => {
    it('làm sạch ngoại lệ Prisma P2002 và không làm lộ câu lệnh SQL ra ngoài', async () => {
      const prismaError = new Prisma.PrismaClientKnownRequestError(
        'Unique constraint failed on the fields: (`reply_message_id`) INSERT INTO orchestration_checkpoints...',
        {
          code: 'P2002',
          clientVersion: '6.19.3',
        },
      );

      mockPrisma.checkpoint.create.mockRejectedValue(prismaError);

      await expect(
        service.create({
          replyMessageId: 'reply-dup',
          userId: 'usr-1',
          conversationId: 'conv-1',
          originalPrompt: 'prompt',
          pendingTask: 'task',
        }),
      ).rejects.toThrow(DatabaseOperationException);

      try {
        await service.create({
          replyMessageId: 'reply-dup',
          userId: 'usr-1',
          conversationId: 'conv-1',
          originalPrompt: 'prompt',
          pendingTask: 'task',
        });
      } catch (err: unknown) {
        const error = err as DatabaseOperationException;
        expect(error.code).toBe('DUPLICATE_RESOURCE');
        expect(error.statusCode).toBe(409);
        expect(error.message).not.toContain('INSERT INTO');
        expect(error.message).not.toContain('reply_message_id');
      }
    });
  });
});
