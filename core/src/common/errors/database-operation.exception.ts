import { BaseDomainException } from './base-domain.exception';

/**
 * Domain Exception chuẩn cho các lỗi thao tác cơ sở dữ liệu.
 * Đảm bảo 100% không để lộ câu lệnh SQL, tên bảng, cấu trúc schema hoặc thông tin nội bộ ra ngoài client.
 */
export class DatabaseOperationException extends BaseDomainException {
  public readonly code: string;
  public readonly statusCode: number;

  constructor(
    sanitizedMessage: string,
    options?: {
      code?: string;
      statusCode?: number;
      details?: Record<string, unknown>;
      isOperational?: boolean;
    },
  ) {
    super(sanitizedMessage, {
      userFriendlyMessage: sanitizedMessage,
      details: options?.details,
      isOperational: options?.isOperational ?? true,
    });
    this.code = options?.code ?? 'DATABASE_OPERATION_ERROR';
    this.statusCode = options?.statusCode ?? 500;
  }
}
