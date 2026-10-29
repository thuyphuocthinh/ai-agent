import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  context,
  trace,
  SpanStatusCode,
  type Span as OtelSpan,
  type Tracer,
} from '@opentelemetry/api';
import type {
  ISpan,
  ISpanOptions,
  ISpanStatus,
  ITracerService,
  TSpanAttributes,
} from '../../contracts/observability/tracer.interface';
import { NoopSpan, NoopTracerService } from './noop-tracer.service';

/**
 * Adapter bọc OpenTelemetry Span thành ISpan nội bộ của Agent Core.
 */
export class OpenTelemetrySpan implements ISpan {
  constructor(private readonly span: OtelSpan) {}

  get traceId(): string {
    return this.span.spanContext().traceId;
  }

  get spanId(): string {
    return this.span.spanContext().spanId;
  }

  setAttribute(
    key: string,
    value: string | number | boolean | string[] | number[],
  ): this {
    this.span.setAttribute(key, value);
    return this;
  }

  setAttributes(attributes: TSpanAttributes): this {
    Object.entries(attributes).forEach(([key, value]) => {
      if (value !== undefined) {
        this.span.setAttribute(key, value);
      }
    });
    return this;
  }

  recordException(error: Error | string): this {
    if (typeof error === 'string') {
      this.span.recordException(new Error(error));
    } else {
      this.span.recordException(error);
    }
    return this;
  }

  setStatus(status: ISpanStatus): this {
    const statusCode =
      status.code === 'OK' ? SpanStatusCode.OK : SpanStatusCode.ERROR;
    this.span.setStatus({ code: statusCode, message: status.message });
    return this;
  }

  end(): void {
    this.span.end();
  }
}

/**
 * OpenTelemetry Tracer Service.
 * Quản trị phân tán dấu vết (Distributed Tracing) cho Agent Core.
 * Tự động chuyển đổi sang No-Op nếu OTEL_ENABLED=false.
 */
@Injectable()
export class OpenTelemetryTracerService implements ITracerService {
  private readonly logger = new Logger(OpenTelemetryTracerService.name);
  private readonly tracer: Tracer;
  private readonly isEnabled: boolean;
  private readonly fallback = new NoopTracerService();

  constructor(private readonly configService: ConfigService) {
    const otelEnv = this.configService.get<string>('OTEL_ENABLED');
    const otlpEndpoint = this.configService.get<string>(
      'OTEL_EXPORTER_OTLP_ENDPOINT',
    );

    this.isEnabled =
      otelEnv === 'true' || (otelEnv !== 'false' && Boolean(otlpEndpoint));

    if (this.isEnabled) {
      this.tracer = trace.getTracer('enterprise-agent-core');
      this.logger.log(
        `OpenTelemetry tracing initialized (endpoint: ${otlpEndpoint || 'default'})`,
      );
    } else {
      this.tracer = trace.getTracer('noop');
      this.logger.debug(
        'OpenTelemetry tracing disabled — using transparent no-op tracer.',
      );
    }
  }

  startSpan(name: string, options?: ISpanOptions): ISpan {
    if (!this.isEnabled) {
      return this.fallback.startSpan();
    }

    const otelSpan = this.tracer.startSpan(name, {
      root: options?.root,
    });

    const span = new OpenTelemetrySpan(otelSpan);
    if (options?.attributes) {
      span.setAttributes(options.attributes);
    }
    return span;
  }

  async withSpan<T>(
    name: string,
    fn: (span: ISpan) => Promise<T>,
    options?: ISpanOptions,
  ): Promise<T> {
    if (!this.isEnabled) {
      return this.fallback.withSpan(name, fn, options);
    }

    const otelSpan = this.tracer.startSpan(name, {
      root: options?.root,
    });

    const span = new OpenTelemetrySpan(otelSpan);
    if (options?.attributes) {
      span.setAttributes(options.attributes);
    }

    const activeCtx = trace.setSpan(context.active(), otelSpan);

    return context.with(activeCtx, async () => {
      try {
        const result = await fn(span);
        span.setStatus({ code: 'OK' });
        return result;
      } catch (error) {
        span.recordException(error as Error);
        span.setStatus({
          code: 'ERROR',
          message: (error as Error)?.message || 'Span execution failed',
        });
        throw error;
      } finally {
        span.end();
      }
    });
  }

  getActiveSpan(): ISpan | undefined {
    if (!this.isEnabled) {
      return undefined;
    }
    const current = trace.getSpan(context.active());
    return current ? new OpenTelemetrySpan(current) : undefined;
  }

  getTraceContext(): { traceId?: string; spanId?: string } {
    if (!this.isEnabled) {
      return {};
    }
    const current = trace.getSpan(context.active());
    if (!current) {
      return {};
    }
    const ctx = current.spanContext();
    return {
      traceId: ctx.traceId,
      spanId: ctx.spanId,
    };
  }
}
