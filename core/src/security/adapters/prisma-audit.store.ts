import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'crypto';
import { IAuditStore } from '../contracts/audit-store.interface';
import { AuditLogEntry } from '../security.interface';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { sanitizePrismaError } from '../../common/errors';
import { AuditStatus, Prisma } from '@prisma/client';
import { EReviewerType } from '../constants/security.constants';

/**
 * PrismaAuditStore
 * Triển khai IAuditStore lưu trữ nhật ký kiểm toán bất biến (Immutable Audit Log) trên PostgreSQL qua Prisma.
 * Tính toán SHA-256 fingerprint phục vụ kiểm tra tính toàn vẹn và chống trùng lặp (Idempotency).
 * Khử sạch 100% lỗi SQL ra khỏi phản hồi client.
 */
@Injectable()
export class PrismaAuditStore implements IAuditStore {
  private readonly logger = new Logger(PrismaAuditStore.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Tính toán hoặc chuẩn hóa SHA-256 fingerprint từ dữ liệu kiểm toán.
   */
  public calculateFingerprint(entry: AuditLogEntry): string {
    if (entry.idempotencyKey && entry.idempotencyKey.length === 64) {
      return entry.idempotencyKey;
    }

    const payload = JSON.stringify({
      userId: entry.userId,
      actionType: entry.actionType,
      targetResource: entry.targetResource || {},
      entityId: entry.entityId || '',
      amount: entry.amount || 0,
      salt: entry.idempotencyKey || '',
    });

    return createHash('sha256').update(payload).digest('hex');
  }

  async save(entry: AuditLogEntry): Promise<void> {
    try {
      const fingerprint = this.calculateFingerprint(entry);
      const meta = entry.metadata || {};

      let auditStatus: AuditStatus = AuditStatus.EXECUTED;
      const statusUpper = (entry.evaluationStatus || '').toUpperCase();
      if (statusUpper.includes('VIOLATION') || statusUpper.includes('BLOCKED') || statusUpper.includes('DENY')) {
        auditStatus = AuditStatus.BLOCKED;
      } else if (statusUpper.includes('REQUIRED') || statusUpper.includes('PENDING') || statusUpper.includes('APPROVAL')) {
        auditStatus = AuditStatus.PENDING_APPROVAL;
      } else if (statusUpper.includes('REJECT')) {
        auditStatus = AuditStatus.REJECTED;
      }

      const inputArgs: Prisma.InputJsonObject = meta.inputArgs
        ? (JSON.parse(JSON.stringify(meta.inputArgs)) as Prisma.InputJsonObject)
        : (JSON.parse(
            JSON.stringify({
              targetResource: entry.targetResource || null,
              entityId: entry.entityId || null,
              amount: entry.amount || null,
            }),
          ) as Prisma.InputJsonObject);

      const provider = typeof meta.provider === 'string' ? meta.provider : 'security_engine';
      const toolName = typeof meta.toolName === 'string' ? meta.toolName : entry.actionType;
      const citedRuleId = typeof meta.citedRuleId === 'string' ? meta.citedRuleId : null;
      const resultPreview = typeof meta.resultPreview === 'string' ? meta.resultPreview : null;

      await this.prisma.auditLog.create({
        data: {
          id: entry.id,
          timestamp: entry.timestamp || new Date(),
          userId: entry.userId || null,
          conversationId: (meta.conversationId as string) || null,
          provider: provider.slice(0, 100),
          toolName: toolName.slice(0, 100),
          actionType: entry.actionType.slice(0, 50),
          fingerprint,
          inputArgs,
          resultPreview,
          verdict: entry.evaluationStatus.slice(0, 50),
          citedRuleId,
          status: auditStatus,
          metadata: JSON.parse(JSON.stringify(meta)) as Prisma.InputJsonObject,
        },
      });
    } catch (error) {
      throw sanitizePrismaError(error, 'PrismaAuditStore.save');
    }
  }

  async findByUserId(userId: string): Promise<AuditLogEntry[]> {
    try {
      const records = await this.prisma.auditLog.findMany({
        where: { userId },
        orderBy: { timestamp: 'desc' },
      });

      return records.map((r) => this.mapToEntry(r));
    } catch (error) {
      throw sanitizePrismaError(error, 'PrismaAuditStore.findByUserId');
    }
  }

  async findByEntityId(entityId: string): Promise<AuditLogEntry[]> {
    try {
      const records = await this.prisma.auditLog.findMany({
        where: {
          metadata: {
            path: ['entityId'],
            equals: entityId,
          },
        },
        orderBy: { timestamp: 'desc' },
      });

      return records.map((r) => this.mapToEntry(r));
    } catch (error) {
      throw sanitizePrismaError(error, 'PrismaAuditStore.findByEntityId');
    }
  }

  async getRecentLogs(limit = 100): Promise<AuditLogEntry[]> {
    try {
      const records = await this.prisma.auditLog.findMany({
        take: limit,
        orderBy: { timestamp: 'desc' },
      });

      return records.map((r) => this.mapToEntry(r));
    } catch (error) {
      throw sanitizePrismaError(error, 'PrismaAuditStore.getRecentLogs');
    }
  }

  private mapToEntry(r: {
    id: string;
    timestamp: Date;
    userId: string | null;
    actionType: string;
    verdict: string;
    fingerprint: string;
    metadata: Prisma.JsonValue | null;
  }): AuditLogEntry {
    const meta =
      r.metadata && typeof r.metadata === 'object' && !Array.isArray(r.metadata)
        ? (r.metadata as Record<string, unknown>)
        : {};

    return {
      id: r.id,
      timestamp: r.timestamp,
      userId: r.userId || '',
      actionType: r.actionType,
      evaluationStatus: r.verdict,
      reviewer: (meta.reviewer as EReviewerType) || EReviewerType.AI,
      idempotencyKey: r.fingerprint,
      metadata: meta,
    };
  }
}
