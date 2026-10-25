import { PrismaTriggerClaimService } from './prisma-trigger-claim.service';
import { PrismaService } from '../prisma.service';
import { Prisma } from '@prisma/client';
import { DatabaseOperationException } from '../../../common/errors';

describe('PrismaTriggerClaimService', () => {
  let service: PrismaTriggerClaimService;
  let mockPrisma: {
    triggerClaim: {
      createMany: jest.Mock;
      deleteMany: jest.Mock;
    };
  };

  beforeEach(() => {
    mockPrisma = {
      triggerClaim: {
        createMany: jest.fn(),
        deleteMany: jest.fn(),
      },
    };

    service = new PrismaTriggerClaimService(mockPrisma as unknown as PrismaService);
  });

  describe('claim', () => {
    it('trả về true khi là worker đầu tiên claim trigger message', async () => {
      mockPrisma.triggerClaim.createMany.mockResolvedValue({ count: 1 });

      const claimed = await service.claim('msg-trigger-1');

      expect(claimed).toBe(true);
      expect(mockPrisma.triggerClaim.createMany).toHaveBeenCalledWith({
        data: [
          expect.objectContaining({
            triggerMessageId: 'msg-trigger-1',
          }),
        ],
        skipDuplicates: true,
      });
    });

    it('trả về false khi trigger message đã bị worker khác xử lý trước (skipDuplicates)', async () => {
      mockPrisma.triggerClaim.createMany.mockResolvedValue({ count: 0 });

      const claimed = await service.claim('msg-trigger-1');

      expect(claimed).toBe(false);
    });
  });

  describe('release', () => {
    it('xóa claim để cho phép retry khi bước khởi tạo lượt chat thất bại sớm', async () => {
      mockPrisma.triggerClaim.deleteMany.mockResolvedValue({ count: 1 });

      await service.release('msg-trigger-1');

      expect(mockPrisma.triggerClaim.deleteMany).toHaveBeenCalledWith({
        where: { triggerMessageId: 'msg-trigger-1' },
      });
    });
  });

  describe('reapStaleClaims', () => {
    it('dọn dẹp các claims mồ côi cũ hơn thời hạn TTL', async () => {
      mockPrisma.triggerClaim.deleteMany.mockResolvedValue({ count: 3 });

      await service.reapStaleClaims();

      expect(mockPrisma.triggerClaim.deleteMany).toHaveBeenCalledWith({
        where: {
          createdAt: {
            lt: expect.any(Date),
          },
        },
      });
    });
  });

  describe('Bảo mật lỗi (No SQL leak)', () => {
    it('làm sạch ngoại lệ Prisma và không làm lộ cú pháp SQL khi có lỗi DB', async () => {
      const prismaError = new Prisma.PrismaClientKnownRequestError(
        'Database connection lost: SELECT * FROM orchestration_trigger_claims...',
        {
          code: 'P2024',
          clientVersion: '6.19.3',
        },
      );

      mockPrisma.triggerClaim.createMany.mockRejectedValue(prismaError);

      await expect(service.claim('msg-crash')).rejects.toThrow(DatabaseOperationException);

      try {
        await service.claim('msg-crash');
      } catch (err: unknown) {
        const error = err as DatabaseOperationException;
        expect(error.code).toBe('DATABASE_TIMEOUT');
        expect(error.statusCode).toBe(503);
        expect(error.message).not.toContain('SELECT');
        expect(error.message).not.toContain('orchestration_trigger_claims');
      }
    });
  });
});
