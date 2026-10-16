import { Injectable } from '@nestjs/common';
import { CachedService } from '@agent/core/infrastructure/redis';
import { DatabaseHealthService } from '@agent/core/infrastructure/database';
import { QueueService, EQueueName } from '@agent/core/infrastructure/queue';
import { HealthCheckResponseDto } from '../contracts/dtos/orchestration.dto';
import { CircuitBreakerService } from './circuit-breaker.service';
import { MetricsRegistryService } from './metrics-registry.service';

// Backpressure/Admission control, mục 2 — orchestration là service TCP thuần
// (không có HTTP `/health`), nên trạng thái này chỉ lộ ra qua message pattern
// HEALTH_CHECK, để api-gateway (hoặc 1 process giám sát ngoài) gọi định kỳ.
@Injectable()
export class HealthCheckService {
  constructor(
    private readonly cached: CachedService,
    private readonly databaseHealth: DatabaseHealthService,
    private readonly circuitBreaker: CircuitBreakerService,
    private readonly queueService: QueueService,
    private readonly metrics: MetricsRegistryService,
  ) {}

  async check(): Promise<HealthCheckResponseDto> {
    const [redis, database, queueDepth, circuitBreakers] = await Promise.all([
      this.cached.ping(),
      this.databaseHealth.isAlive(),
      this.queueService.getJobCounts(EQueueName.AI_ORCHESTRATION_QUEUE),
      this.circuitBreaker.getStates(),
    ]);

    // Nhân tiện cập nhật gauge queue depth ngay tại đây — không cần 1 cron
    // riêng chỉ để giữ số liệu tươi, mỗi lần health-check được gọi (api-gateway
    // scrape /metrics cũng đi qua đúng dữ liệu này, xem GetMetricsResponseDto).
    this.metrics.setQueueDepth(queueDepth);

    return {
      status: redis && database ? 'ok' : 'degraded',
      redis,
      database,
      circuitBreakers,
      queueDepth,
    };
  }

  async getMetricsText(): Promise<string> {
    return this.metrics.getMetricsText();
  }
}
