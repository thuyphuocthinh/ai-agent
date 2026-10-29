import { Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { DatabaseOperationException } from './database-operation.exception';

const logger = new Logger('PrismaErrorSanitizer');

const PRISMA_UNIQUE_VIOLATION = 'P2002';

// Vi phạm ràng buộc unique — để nơi gọi dịch thành lỗi nghiệp vụ riêng (VD slug trùng).
export function isPrismaUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === PRISMA_UNIQUE_VIOLATION
  );
}

/**
 * Bóc tách và làm sạch triệt để mọi lỗi từ Prisma/Postgres trước khi quăng ra ngoài.
 * TUYỆT ĐỐI không để lộ SQL query, table name, connection string hoặc internal stack trace ra message client.
 * Lỗi kỹ thuật chi tiết chỉ được ghi nhận vào private application logger.
 */
export function sanitizePrismaError(
  error: unknown,
  context: string,
): DatabaseOperationException {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    logger.error(
      `[PrismaKnownError] Context: ${context} | Code: ${error.code} | Meta: ${JSON.stringify(error.meta)}`,
      error.stack,
    );

    switch (error.code) {
      case 'P2000': {
        // Value too long for column
        return new DatabaseOperationException(
          'Dữ liệu đầu vào vượt quá giới hạn độ dài cho phép của hệ thống lưu trữ.',
          {
            code: 'VALUE_TOO_LONG',
            statusCode: 400,
          },
        );
      }
      case PRISMA_UNIQUE_VIOLATION: {
        // Unique constraint violation
        return new DatabaseOperationException(
          'Dữ liệu yêu cầu đã tồn tại trong hệ thống hoặc bị trùng lặp định danh.',
          {
            code: 'DUPLICATE_RESOURCE',
            statusCode: 409,
          },
        );
      }
      case 'P2025': {
        // Record not found
        return new DatabaseOperationException(
          'Không tìm thấy bản ghi dữ liệu yêu cầu hoặc bản ghi đã bị xóa.',
          {
            code: 'RECORD_NOT_FOUND',
            statusCode: 404,
          },
        );
      }
      case 'P2003': {
        // Foreign key constraint failed
        return new DatabaseOperationException(
          'Thao tác không hợp lệ do liên kết dữ liệu không tồn tại.',
          {
            code: 'FOREIGN_KEY_VIOLATION',
            statusCode: 400,
          },
        );
      }
      case 'P2024': {
        // Timed out fetching a connection from the pool
        return new DatabaseOperationException(
          'Hệ thống lưu trữ đang bận hoặc quá tải kết nối, vui lòng thử lại sau ít phút.',
          {
            code: 'DATABASE_TIMEOUT',
            statusCode: 503,
          },
        );
      }
      default: {
        return new DatabaseOperationException(
          'Yêu cầu thao tác cơ sở dữ liệu không thành công.',
          {
            code: 'DATABASE_REQUEST_FAILED',
            statusCode: 500,
          },
        );
      }
    }
  }

  if (error instanceof Prisma.PrismaClientInitializationError) {
    logger.error(`[PrismaInitError] Context: ${context} | Message: ${error.message}`, error.stack);
    return new DatabaseOperationException(
      'Dịch vụ lưu trữ dữ liệu tạm thời không khả dụng. Vui lòng thử lại sau.',
      {
        code: 'DATABASE_UNAVAILABLE',
        statusCode: 503,
      },
    );
  }

  if (error instanceof Prisma.PrismaClientValidationError) {
    logger.error(`[PrismaValidationError] Context: ${context} | Message: ${error.message}`, error.stack);
    return new DatabaseOperationException(
      'Dữ liệu cung cấp không hợp lệ theo chuẩn của hệ thống lưu trữ.',
      {
        code: 'DATABASE_VALIDATION_ERROR',
        statusCode: 400,
      },
    );
  }

  if (error instanceof DatabaseOperationException) {
    return error;
  }

  logger.error(
    `[DatabaseUnexpectedError] Context: ${context} | Unknown error: ${(error as Error)?.message}`,
    (error as Error)?.stack,
  );
  return new DatabaseOperationException(
    'Đã xảy ra lỗi nội bộ trong quá trình lưu trữ dữ liệu.',
    {
      code: 'DATABASE_INTERNAL_ERROR',
      statusCode: 500,
    },
  );
}
