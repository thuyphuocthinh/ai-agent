/**
 * Lớp trừu tượng gốc đại diện cho mọi ngoại lệ miền (Domain Exception)
 * trong hệ sinh thái AI Agent Core.
 *
 * Tuân thủ Clean Architecture: Không phụ thuộc vào framework HTTP bên ngoài (@nestjs/common),
 * nhưng mang đầy đủ metadata chuẩn hóa để tầng Presentation (HTTP Filter, SSE Stream)
 * tự động bóc tách và phản hồi đa hình.
 */
export abstract class BaseDomainException extends Error {
  public readonly isDomainException = true;
  public abstract readonly code: string;
  public abstract readonly statusCode: number;
  public readonly isOperational: boolean;
  public readonly details?: Record<string, unknown>;
  public readonly userFriendlyMessage?: string;

  constructor(
    message: string,
    options?: {
      details?: Record<string, unknown>;
      userFriendlyMessage?: string;
      isOperational?: boolean;
    },
  ) {
    super(message);
    this.name = this.constructor.name;
    this.details = options?.details;
    this.userFriendlyMessage = options?.userFriendlyMessage;
    this.isOperational = options?.isOperational ?? true;

    // Đảm bảo prototype chain hợp lệ cho instanceof trong môi trường biên dịch ES/TS
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Type guard kiểm tra đối tượng có phải là BaseDomainException hay không.
 * Phòng thủ vững chắc khi instance vượt qua ranh giới worker/bundle.
 */
export function isBaseDomainException(error: unknown): error is BaseDomainException {
  if (error instanceof BaseDomainException) {
    return true;
  }

  if (typeof error === 'object' && error !== null) {
    const candidate = error as Record<string, unknown>;
    return (
      candidate.isDomainException === true &&
      typeof candidate.code === 'string' &&
      typeof candidate.statusCode === 'number'
    );
  }

  return false;
}
