import { Inject, Injectable, Logger } from '@nestjs/common';
import { IDEMPOTENCY_STORE } from '../constants/security.constants';
import type {
  AcquireResult,
  IdempotencyRecord,
  IIdempotencyStore,
} from '../contracts/idempotency-store.interface';
import type {
  CanonicalToolFingerprintParams,
  ToolFingerprintIdempotencyParams,
} from './idempotency.types';
import { computeCanonicalToolFingerprint } from './canonical-hasher';

/**
 * Universal Idempotency Manager:
 * Quản lý tính lũy đẳng dựa trên Universal Canonical SHA-256 Fingerprint.
 * Đảm bảo 100% mọi tool call (gửi email, sửa database, cập nhật quyền, gọi Stripe/GitHub)
 * đều được chống thực thi trùng lặp, hoàn toàn độc lập với cấu trúc tham số hay sự hiện diện của trường 'id'.
 */
@Injectable()
export class IdempotencyManager {
  private readonly logger = new Logger(IdempotencyManager.name);

  constructor(
    @Inject(IDEMPOTENCY_STORE)
    private readonly store: IIdempotencyStore,
  ) {}

  /**
   * Sinh khoá lũy đẳng xác định duy nhất bằng thuật toán SHA-256 Canonical Fingerprint.
   */
  generateToolFingerprint(params: CanonicalToolFingerprintParams): string {
    return computeCanonicalToolFingerprint(params);
  }

  /**
   * Sinh khoá theo cú pháp cũ (actionType:entityId:userId) phục vụ tương thích ngược.
   */
  generateKey(actionType: string, entityId: string, userId: string): string {
    return `${actionType.toLowerCase()}:${entityId}:${userId}`;
  }

  /**
   * Đăng ký chiếm quyền thực thi cho khoá lũy đẳng.
   */
  async acquire(key: string, ttlSeconds = 120): Promise<AcquireResult> {
    const result = await this.store.acquire(key, ttlSeconds);
    if (!result.success) {
      this.logger.warn(
        `Từ chối chiếm quyền idempotency cho key="${key}": reason=${result.reason}`,
      );
    }
    return result;
  }

  /**
   * Chiếm quyền thực thi trực tiếp từ thông số Tool Call sử dụng SHA-256 fingerprint.
   */
  async acquireForTool(
    params: ToolFingerprintIdempotencyParams,
  ): Promise<AcquireResult & { fingerprint: string }> {
    const fingerprint = this.generateToolFingerprint(params);
    const result = await this.acquire(fingerprint, params.ttlSeconds ?? 120);
    return {
      ...result,
      fingerprint,
    };
  }

  /**
   * Đánh dấu hành động đã hoàn tất thành công và lưu kết quả.
   */
  async complete(
    key: string,
    result?: unknown,
    retainSeconds = 300,
  ): Promise<void> {
    await this.store.complete(key, result, retainSeconds);
  }

  /**
   * Giải phóng khoá nếu hành động thất bại (cho phép thử lại).
   */
  async release(key: string): Promise<void> {
    await this.store.release(key);
  }

  /**
   * Tra cứu trạng thái của khóa hiện tại.
   */
  async get(key: string): Promise<IdempotencyRecord | null> {
    return this.store.get(key);
  }
}
