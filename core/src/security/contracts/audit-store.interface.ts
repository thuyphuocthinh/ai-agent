import { AuditLogEntry } from '../security.interface';

/**
 * Cổng giao tiếp lưu trữ nhật ký kiểm toán (Audit Store Port).
 * Trừu tượng hóa nơi lưu trữ: RAM, TypeORM (Postgres/SQLite), hoặc Elasticsearch.
 */
export interface IAuditStore {
  /**
   * Lưu trữ bản ghi kiểm toán mới.
   */
  save(entry: AuditLogEntry): Promise<void>;

  /**
   * Truy vấn nhật ký theo người dùng.
   */
  findByUserId(userId: string): Promise<AuditLogEntry[]>;

  /**
   * Truy vấn nhật ký theo mã thực thể (ví dụ: orderId).
   */
  findByEntityId(entityId: string): Promise<AuditLogEntry[]>;

  /**
   * Lấy danh sách các bản ghi kiểm toán gần nhất.
   */
  getRecentLogs(limit?: number): Promise<AuditLogEntry[]>;
}
