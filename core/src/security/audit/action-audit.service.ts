import { Inject, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import type { AuditLogEntry } from '../security.interface';
import { PiiScrubberUtil } from '../../common/text/pii/pii-scrubber.util';
import type { StrictJsonValue } from '../../common/types';
import { AUDIT_STORE } from '../constants/security.constants';
import type { IAuditStore } from '../contracts/audit-store.interface';

/**
 * Service ghi nhận nhật ký kiểm toán (Audit Trail) bất biến
 * cho các hành động thay đổi trạng thái và hành động rủi ro cao.
 * Tự động che giấu (masking) thông tin PII trước khi lưu trữ.
 * Phụ thuộc qua IAuditStore Port (hỗ trợ cắm rút In-Memory / TypeORM / Redis).
 */
@Injectable()
export class ActionAuditService {
  private readonly logger = new Logger(ActionAuditService.name);

  constructor(
    @Inject(AUDIT_STORE)
    private readonly store: IAuditStore,
  ) {}

  /**
   * Ghi log hành động kiểm toán với dữ liệu nhạy cảm đã được làm sạch.
   */
  async record(
    entry: Omit<AuditLogEntry, 'id' | 'timestamp'>,
  ): Promise<AuditLogEntry> {
    const scrubbedMetadata = entry.metadata
      ? (PiiScrubberUtil.scrub(entry.metadata as StrictJsonValue) as Record<
          string,
          unknown
        >)
      : undefined;

    const logEntry: AuditLogEntry = {
      id: randomUUID(),
      timestamp: new Date(),
      userId: entry.userId,
      tenantId: entry.tenantId,
      actionType: entry.actionType,
      targetResource: entry.targetResource,
      entityId: entry.entityId,
      amount: entry.amount,
      evaluationStatus: entry.evaluationStatus,
      reviewer: entry.reviewer,
      idempotencyKey: entry.idempotencyKey,
      metadata: scrubbedMetadata,
    };

    await this.store.save(logEntry);

    this.logger.log(
      `[AUDIT] user=${logEntry.userId} action=${logEntry.actionType} status=${logEntry.evaluationStatus} target=${logEntry.targetResource ? `${logEntry.targetResource.domain}/${logEntry.targetResource.type}#${logEntry.targetResource.id}` : logEntry.entityId || 'N/A'} amount=${logEntry.amount || 0}`,
    );

    return logEntry;
  }

  /**
   * Truy vấn lịch sử kiểm toán theo người dùng.
   */
  async findByUserId(userId: string): Promise<AuditLogEntry[]> {
    return this.store.findByUserId(userId);
  }

  /**
   * Truy vấn lịch sử kiểm toán theo mã thực thể (ví dụ orderId).
   */
  async findByEntityId(entityId: string): Promise<AuditLogEntry[]> {
    return this.store.findByEntityId(entityId);
  }

  /**
   * Lấy danh sách kiểm toán gần nhất.
   */
  async getRecentLogs(limit = 100): Promise<AuditLogEntry[]> {
    return this.store.getRecentLogs(limit);
  }
}
