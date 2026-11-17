import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  StreamableFile,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { randomUUID } from 'crypto';
import { BYPASS_TRANSFORM_KEY } from '../decorators/bypass-transform.decorator';
import { ApiResponseDto } from '../dtos/api-response.dto';

/**
 * Interceptor tự động bọc kết quả phản hồi REST vào schema ApiResponseDto chuẩn.
 * Tự động bỏ qua (bypass) đối với các kết nối SSE streaming hoặc route có @BypassTransform().
 */
@Injectable()
export class TransformResponseInterceptor<T>
  implements NestInterceptor<T, ApiResponseDto<T> | T | StreamableFile>
{
  constructor(private readonly reflector: Reflector) {}

  intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Observable<ApiResponseDto<T> | T | StreamableFile> {
    const isBypass = this.reflector.getAllAndOverride<boolean>(
      BYPASS_TRANSFORM_KEY,
      [context.getHandler(), context.getClass()],
    );

    const http = context.switchToHttp();
    const res = http.getResponse();
    const req = http.getRequest();

    // Tự động bypass các route SSE (Server-Sent Events) hoặc route có @BypassTransform()
    if (
      isBypass ||
      res?.getHeader?.('content-type')?.toString().includes('text/event-stream')
    ) {
      return next.handle();
    }

    return next.handle().pipe(
      map((result) => {
        // Lưới an toàn: Không bọc ApiResponseDto nếu handler trả về StreamableFile (nhị phân)
        if (result instanceof StreamableFile) {
          return result;
        }

        const statusCode = res?.statusCode || 200;
        const traceId = (req?.headers?.['x-trace-id'] as string) || randomUUID();

        // Nếu kết quả đã là dạng phân trang { data: [...], meta: {...} }
        if (
          result &&
          typeof result === 'object' &&
          'data' in result &&
          'meta' in result
        ) {
          const paginated = result as { data: T; meta: unknown };
          return new ApiResponseDto<T>({
            statusCode,
            message: 'Success',
            data: paginated.data,
            meta: paginated.meta,
            timestamp: new Date().toISOString(),
            traceId,
          });
        }

        // Response chuẩn đơn lẻ thông thường
        return new ApiResponseDto<T>({
          statusCode,
          message: 'Success',
          data: (result ?? null) as T,
          timestamp: new Date().toISOString(),
          traceId,
        });
      }),
    );
  }
}
