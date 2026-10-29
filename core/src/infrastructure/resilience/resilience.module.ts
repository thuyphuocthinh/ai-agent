import { Module } from '@nestjs/common';
import {
  CIRCUIT_BREAKER,
  PROVIDER_CONCURRENCY_LIMITER,
} from '../../contracts/tools/tool-provider.interface';
import { CircuitBreakerService } from './circuit-breaker.service';
import { MetricsRegistryService } from './metrics-registry.service';
import { ProviderConcurrencyLimiterService } from './provider-concurrency-limiter.service';

/**
 * Gom các service chống lỗi dây chuyền dùng chung (metrics, circuit breaker, concurrency limiter)
 * để OrchestrationModule và ToolsInfrastructureModule cùng chia sẻ một instance duy nhất.
 */
@Module({
  providers: [
    MetricsRegistryService,
    CircuitBreakerService,
    ProviderConcurrencyLimiterService,
    { provide: CIRCUIT_BREAKER, useExisting: CircuitBreakerService },
    {
      provide: PROVIDER_CONCURRENCY_LIMITER,
      useExisting: ProviderConcurrencyLimiterService,
    },
  ],
  exports: [
    MetricsRegistryService,
    CircuitBreakerService,
    ProviderConcurrencyLimiterService,
    CIRCUIT_BREAKER,
    PROVIDER_CONCURRENCY_LIMITER,
  ],
})
export class ResilienceModule {}
