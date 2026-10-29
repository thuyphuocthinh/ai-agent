import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TRACER_SERVICE } from '../../contracts/observability/tracer.interface';
import { NoopTracerService } from './noop-tracer.service';
import { OpenTelemetryTracerService } from './open-telemetry-tracer.service';

/**
 * Module hạ tầng Observability & OpenTelemetry Tracing.
 * Cung cấp TRACER_SERVICE để toàn bộ Core có thể inject và theo dõi dấu vết.
 */
@Module({
  imports: [ConfigModule],
  providers: [
    NoopTracerService,
    OpenTelemetryTracerService,
    {
      provide: TRACER_SERVICE,
      useClass: OpenTelemetryTracerService,
    },
  ],
  exports: [
    TRACER_SERVICE,
    OpenTelemetryTracerService,
    NoopTracerService,
  ],
})
export class ObservabilityModule {}
