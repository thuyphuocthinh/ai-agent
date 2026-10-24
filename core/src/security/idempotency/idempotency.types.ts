/**
 * Định nghĩa hợp đồng dữ liệu cho thuật toán sinh khóa và kiểm soát Idempotency.
 */

export interface CanonicalToolFingerprintParams {
  userId: string;
  provider: string;
  toolName: string;
  args?: Record<string, unknown>;
}

export interface ToolFingerprintIdempotencyParams
  extends CanonicalToolFingerprintParams {
  ttlSeconds?: number;
}
