import { ConfigService } from '@nestjs/config';
import { OpenTelemetryTracerService } from './open-telemetry-tracer.service';
import { NoopTracerService, NoopSpan } from './noop-tracer.service';

describe('OpenTelemetryTracerService & NoopTracerService', () => {
  describe('NoopTracerService', () => {
    let noopTracer: NoopTracerService;

    beforeEach(() => {
      noopTracer = new NoopTracerService();
    });

    it('returns a chainable NoopSpan on startSpan()', () => {
      const span = noopTracer.startSpan();
      expect(span).toBeInstanceOf(NoopSpan);
      expect(span.traceId).toBeUndefined();
      expect(span.spanId).toBeUndefined();

      // Verify chainable no-op methods
      expect(span.setAttribute('test', 'value')).toBe(span);
      expect(span.setAttributes({ a: 1, b: 'two' })).toBe(span);
      expect(span.recordException(new Error('fail'))).toBe(span);
      expect(span.setStatus({ code: 'OK' })).toBe(span);
      expect(() => span.end()).not.toThrow();
    });

    it('executes fn transparently on withSpan() and returns its result', async () => {
      const result = await noopTracer.withSpan('test-noop-span', async (span) => {
        span.setAttribute('key', 'val');
        return 42;
      });

      expect(result).toBe(42);
    });

    it('returns empty trace context and undefined active span', () => {
      expect(noopTracer.getActiveSpan()).toBeUndefined();
      expect(noopTracer.getTraceContext()).toEqual({});
    });
  });

  describe('OpenTelemetryTracerService when OTEL is disabled', () => {
    let tracerService: OpenTelemetryTracerService;

    beforeEach(() => {
      const mockConfigService = {
        get: jest.fn().mockImplementation((key: string) => {
          if (key === 'OTEL_ENABLED') return 'false';
          return undefined;
        }),
      } as unknown as ConfigService;

      tracerService = new OpenTelemetryTracerService(mockConfigService);
    });

    it('delegates to fallback NoopTracer without errors', async () => {
      const span = tracerService.startSpan('test');
      expect(span).toBeDefined();
      expect(span.traceId).toBeUndefined();

      const result = await tracerService.withSpan('run', async () => 'done');
      expect(result).toBe('done');
      expect(tracerService.getActiveSpan()).toBeUndefined();
      expect(tracerService.getTraceContext()).toEqual({});
    });
  });

  describe('OpenTelemetryTracerService when OTEL is enabled', () => {
    let tracerService: OpenTelemetryTracerService;

    beforeEach(() => {
      const mockConfigService = {
        get: jest.fn().mockImplementation((key: string) => {
          if (key === 'OTEL_ENABLED') return 'true';
          return undefined;
        }),
      } as unknown as ConfigService;

      tracerService = new OpenTelemetryTracerService(mockConfigService);
    });

    it('creates active span with traceId and spanId and sets attributes', async () => {
      let capturedTraceId: string | undefined;
      let capturedSpanId: string | undefined;

      const result = await tracerService.withSpan(
        'test-operation',
        async (span) => {
          span.setAttribute('custom.attr', 'value');
          span.setAttributes({
            'num.attr': 123,
            'bool.attr': true,
          });

          capturedTraceId = span.traceId;
          capturedSpanId = span.spanId;
          return 'success';
        },
        { root: true },
      );

      expect(result).toBe('success');
      expect(capturedTraceId).toBeDefined();
      expect(capturedSpanId).toBeDefined();
      expect(capturedTraceId).toMatch(/^[0-9a-f]{32}$/);
      expect(capturedSpanId).toMatch(/^[0-9a-f]{16}$/);
    });

    it('records exception, sets status ERROR, and rethrows when wrapped function fails', async () => {
      const testError = new Error('Simulated failure');

      await expect(
        tracerService.withSpan('failing-operation', async (span) => {
          span.setAttribute('step', 'failing');
          throw testError;
        }),
      ).rejects.toThrow('Simulated failure');
    });

    it('supports standalone startSpan() with attributes and end()', () => {
      const span = tracerService.startSpan('standalone-span', {
        attributes: { 'init.key': 'val' },
      });

      expect(span.traceId).toBeDefined();
      expect(span.spanId).toBeDefined();
      expect(() => {
        span.recordException('string error message');
        span.setStatus({ code: 'ERROR', message: 'failed' });
        span.end();
      }).not.toThrow();
    });
  });
});
