import { EIdempotencyStatus } from '../constants/security.constants';

export interface IdempotencyRecord {
  status: EIdempotencyStatus;
  createdAt: number;
  expiresAt: number;
  result?: unknown;
}

export interface AcquireResult {
  success: boolean;
  reason?: EIdempotencyStatus.IN_PROGRESS | EIdempotencyStatus.EXECUTED;
  previousResult?: unknown;
}

/**
 * Cổng giao tiếp khóa lũy đẳng (Idempotency Store Port).
 * Trừu tượng hóa nơi lưu trữ: RAM, Redis (SET NX EX phân tán).
 */
export interface IIdempotencyStore {
  /**
   * Chiếm quyền khóa thực thi. Trả về success: true nếu lấy được khóa.
   */
  acquire(key: string, ttlSeconds: number): Promise<AcquireResult>;

  /**
   * Đánh dấu hành động đã hoàn tất thành công và lưu kết quả (để trả lời nếu lặp lại).
   */
  complete(key: string, result?: unknown, retainSeconds?: number): Promise<void>;

  /**
   * Giải phóng khóa nếu hành động thất bại (cho phép thử lại).
   */
  release(key: string): Promise<void>;

  /**
   * Tra cứu trạng thái của khóa hiện tại.
   */
  get(key: string): Promise<IdempotencyRecord | null>;
}
