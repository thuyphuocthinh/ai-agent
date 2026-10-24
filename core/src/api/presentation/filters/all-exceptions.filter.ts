import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import { randomUUID } from 'crypto';
import { ApiErrorResponseDto } from '../dtos/api-error-response.dto';
import { ORCHESTRATION_ERROR } from '@agent/core/constants';
import { isBaseDomainException } from '../../../common/errors';

interface HttpResponse {
  status(code: number): HttpResponse;
  json(data: unknown): void;
}

/**
 * Filter bắt toàn bộ ngoại lệ phát sinh trong quá trình xử lý HTTP
 * và định dạng lại thành ApiErrorResponseDto đồng nhất.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<HttpResponse>();
    const request = ctx.getRequest<{
      url?: string;
      method?: string;
      headers?: Record<string, string | string[]>;
    }>();
    const traceId = (request?.headers?.['x-trace-id'] as string) || randomUUID();
    const path = request?.url || '';

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'Internal server error';
    let code = 'INTERNAL_SERVER_ERROR';
    let errors: unknown = undefined;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const res = exception.getResponse();

      if (
        status === HttpStatus.BAD_REQUEST &&
        typeof res === 'object' &&
        res !== null &&
        Array.isArray((res as { message?: unknown }).message)
      ) {
        // Validation errors từ ValidationPipe
        message = 'Validation failed';
        code = 'VALIDATION_ERROR';
        errors = (res as { message: unknown[] }).message;
      } else if (typeof res === 'object' && res !== null) {
        const resObj = res as { message?: string; code?: string; error?: string };
        message = resObj.message || exception.message;
        code = resObj.code || `HTTP_${status}`;
      } else {
        message = exception.message;
        code = `HTTP_${status}`;
      }
    } else if (isBaseDomainException(exception)) {
      status = exception.statusCode;
      code = exception.code;
      message = exception.userFriendlyMessage || exception.message;
      errors = exception.details;

      if (!exception.isOperational) {
        this.logger.error(
          `[Domain Non-Operational] ${request?.method || 'HTTP'} ${path} - ${status} - ${exception.message}`,
          exception.stack,
        );
      } else {
        this.logger.warn(
          `[Domain Operational] ${request?.method || 'HTTP'} ${path} - ${status} [${code}]: ${exception.message}`,
        );
      }
    } else if (exception instanceof RpcException) {
      const detail = exception.getError() as { code?: string; message?: string };
      message = detail?.message || 'Lỗi xử lý điều phối agent';
      code = detail?.code || 'ORCHESTRATION_ERROR';

      switch (detail?.code) {
        case ORCHESTRATION_ERROR.CHECKPOINT_NOT_FOUND.code:
          status = HttpStatus.NOT_FOUND;
          break;
        case ORCHESTRATION_ERROR.CHECKPOINT_FORBIDDEN.code:
          status = HttpStatus.FORBIDDEN;
          break;
        case ORCHESTRATION_ERROR.CHECKPOINT_ALREADY_RESOLVED.code:
          status = HttpStatus.CONFLICT;
          break;
        case ORCHESTRATION_ERROR.CHECKPOINT_ACTION_MISMATCH.code:
          status = HttpStatus.BAD_REQUEST;
          break;
        default:
          status = HttpStatus.BAD_REQUEST;
          break;
      }
    } else {
      this.logger.error(
        `${request?.method || 'HTTP'} ${path} - ${status} - ${(exception as Error)?.message}`,
        (exception as Error)?.stack,
      );
    }

    const errorResponse = new ApiErrorResponseDto({
      statusCode: status,
      code,
      message,
      ...(errors ? { errors } : {}),
      path,
      timestamp: new Date().toISOString(),
      traceId,
    });

    response.status(status).json(errorResponse);
  }
}
