import {
  Catch,
  ExceptionFilter,
  ArgumentsHost,
  HttpException,
  NotFoundException,
  ForbiddenException,
  ConflictException,
  BadRequestException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import { ORCHESTRATION_ERROR } from '@agent/core/constants';

interface HttpResponse {
  status(code: number): HttpResponse;
  json(data: unknown): void;
}

/**
 * ExceptionFilter chuyển đổi các RpcException từ HITL / Orchestration Engine
 * thành HttpException tương ứng theo chuẩn mã lỗi REST của tầng Presentation.
 */
@Catch(RpcException)
export class OrchestrationRpcExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(OrchestrationRpcExceptionFilter.name);

  catch(exception: RpcException, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<HttpResponse>();
    const detail = exception.getError() as { code?: string; message?: string };
    const message = detail?.message ?? 'Không duyệt được yêu cầu';

    const httpException = this.toHttpException(detail, message);
    const status = httpException.getStatus();

    response.status(status).json({
      statusCode: status,
      message: httpException.message,
      errorCode: detail?.code,
    });
  }

  toHttpException(
    detail: { code?: string; message?: string },
    fallbackMessage: string,
  ): HttpException {
    switch (detail?.code) {
      case ORCHESTRATION_ERROR.CHECKPOINT_NOT_FOUND.code:
        return new NotFoundException(fallbackMessage);
      case ORCHESTRATION_ERROR.CHECKPOINT_FORBIDDEN.code:
        return new ForbiddenException(fallbackMessage);
      case ORCHESTRATION_ERROR.CHECKPOINT_ALREADY_RESOLVED.code:
        return new ConflictException(fallbackMessage);
      case ORCHESTRATION_ERROR.CHECKPOINT_ACTION_MISMATCH.code:
        return new BadRequestException(fallbackMessage);
      default:
        this.logger.error(
          `Unhandled RPC orchestration error: ${detail?.code} - ${fallbackMessage}`,
        );
        return new InternalServerErrorException(fallbackMessage);
    }
  }
}
