import { Injectable } from '@nestjs/common';
import type {
  ISpan,
  ISpanOptions,
  ISpanStatus,
  ITracerService,
  TSpanAttributes,
} from '../../contracts/observability/tracer.interface';

/**
 * No-Op implementation của ISpan.
 * Được sử dụng khi OpenTelemetry bị tắt (OTEL_ENABLED=false),
 * đảm bảo 0% overhead tài nguyên mạng/bộ nhớ và không làm chậm hệ thống.
 */
export class NoopSpan implements ISpan {
  readonly traceId = undefined;
  readonly spanId = undefined;

  setAttribute(): this {
    return this;
  }

  setAttributes(): this {
    return this;
  }

  recordException(): this {
    return this;
  }

  setStatus(): this {
    return this;
  }

  end(): void {
    // No-op
  }
}

/**
 * No-Op Tracer Service.
 * Thực hiện pass-through mọi lệnh gọi trace một cách trong suốt.
 */
@Injectable()
export class NoopTracerService implements ITracerService {
  private readonly noopSpan = new NoopSpan();

  startSpan(): ISpan {
    return this.noopSpan;
  }

  async withSpan<T>(
    _name: string,
    fn: (span: ISpan) => Promise<T>,
    _options?: ISpanOptions,
  ): Promise<T> {
    return fn(this.noopSpan);
  }

  getActiveSpan(): ISpan | undefined {
    return undefined;
  }

  getTraceContext(): { traceId?: string; spanId?: string } {
    return {};
  }
}
