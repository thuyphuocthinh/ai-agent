import { PrismaAuditStore } from './prisma-audit.store';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { AuditStatus, Prisma } from '@prisma/client';
import { DatabaseOperationException } from '../../common/errors';
import { AuditLogEntry } from '../security.interface';
import { EReviewerType } from '../constants/security.constants';

describe('PrismaAuditStore', () => {
  let store: PrismaAuditStore;
  let mockPrisma: {
    auditLog: {
      create: jest.Mock;
      findMany: jest.Mock;
    };
  };

  beforeEach(() => {
    mockPrisma = {
      auditLog: {
        create: jest.fn().mockResolvedValue({}),
        findMany: jest.fn(),
      },
    };

    store = new PrismaAuditStore(mockPrisma as unknown as PrismaService);
  });

  describe('calculateFingerprint', () => {
    it('tính toán SHA-256 fingerprint đúng 64 ký tự hex', () => {
      const entry: AuditLogEntry = {
        id: 'audit-1',
        timestamp: new Date(),
        userId: 'usr-100',
        actionType: 'EXECUTE_WRITE_QUERY',
        evaluationStatus: 'ALLOW',
        reviewer: EReviewerType.AI,
        amount: 500,
      };

      const fp1 = store.calculateFingerprint(entry);
      expect(fp1).toHaveLength(64);

      // Cùng dữ liệu phải sinh ra cùng fingerprint (Idempotent)
      const fp2 = store.calculateFingerprint(entry);
      expect(fp1).toBe(fp2);
    });

    it('tôn trọng idempotencyKey nếu đã là chuỗi 64 ký tự hợp lệ', () => {
      const fixed64 = 'a'.repeat(64);
      const entry: AuditLogEntry = {
        id: 'audit-2',
        timestamp: new Date(),
        userId: 'usr-100',
        actionType: 'REFUND',
        evaluationStatus: 'ALLOW',
        reviewer: EReviewerType.HUMAN,
        idempotencyKey: fixed64,
      };

      const fp = store.calculateFingerprint(entry);
      expect(fp).toBe(fixed64);
    });
  });

  describe('save', () => {
    it('lưu bản ghi kiểm toán và map trạng thái VIOLATION thành BLOCKED', async () => {
      const entry: AuditLogEntry = {
        id: 'audit-sec-1',
        timestamp: new Date(),
        userId: 'usr-devops',
        actionType: 'DROP_TABLE',
        evaluationStatus: 'POLICY_VIOLATION',
        reviewer: EReviewerType.AI,
      };

      await store.save(entry);

      expect(mockPrisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            id: 'audit-sec-1',
            userId: 'usr-devops',
            actionType: 'DROP_TABLE',
            status: AuditStatus.BLOCKED,
          }),
        }),
      );
    });

    it('map trạng thái REQUIRE_APPROVAL thành PENDING_APPROVAL', async () => {
      const entry: AuditLogEntry = {
        id: 'audit-sec-2',
        timestamp: new Date(),
        userId: 'usr-fin',
        actionType: 'REFUND_LARGE',
        evaluationStatus: 'USER_CONFIRMATION_REQUIRED',
        reviewer: EReviewerType.AI,
      };

      await store.save(entry);

      expect(mockPrisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: AuditStatus.PENDING_APPROVAL,
          }),
        }),
      );
    });
  });

  describe('findByUserId & getRecentLogs', () => {
    it('truy vấn danh sách theo userId', async () => {
      mockPrisma.auditLog.findMany.mockResolvedValue([
        {
          id: 'log-1',
          timestamp: new Date(),
          userId: 'usr-99',
          actionType: 'QUERY',
          verdict: 'ALLOW',
          fingerprint: 'fp-1',
          metadata: {},
        },
      ]);

      const res = await store.findByUserId('usr-99');
      expect(res).toHaveLength(1);
      expect(res[0].userId).toBe('usr-99');
    });
  });

  describe('Bảo mật lỗi (No SQL leak)', () => {
    it('làm sạch ngoại lệ Prisma P2024 (timeout) và không để lộ thông số kết nối DB', async () => {
      const prismaError = new Prisma.PrismaClientKnownRequestError(
        'Timed out fetching a connection from the pool at postgresql://postgres:postgres@localhost:5432/...',
        {
          code: 'P2024',
          clientVersion: '6.19.3',
        },
      );

      mockPrisma.auditLog.create.mockRejectedValue(prismaError);

      const entry: AuditLogEntry = {
        id: 'audit-timeout',
        timestamp: new Date(),
        userId: 'usr-timeout',
        actionType: 'TEST',
        evaluationStatus: 'ALLOW',
        reviewer: EReviewerType.AI,
      };

      await expect(store.save(entry)).rejects.toThrow(DatabaseOperationException);

      try {
        await store.save(entry);
      } catch (err: unknown) {
        const error = err as DatabaseOperationException;
        expect(error.code).toBe('DATABASE_TIMEOUT');
        expect(error.statusCode).toBe(503);
        expect(error.message).not.toContain('postgresql://');
        expect(error.message).not.toContain('localhost:5432');
        expect(error.message).toContain('Hệ thống lưu trữ đang bận');
      }
    });
  });
});
