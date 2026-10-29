import { MetricsController } from './metrics.controller';
import { HealthCheckService } from '../../../infrastructure/resilience/health-check.service';
import { BYPASS_TRANSFORM_KEY } from '../decorators/bypass-transform.decorator';
import { Reflector } from '@nestjs/core';

describe('MetricsController', () => {
  let controller: MetricsController;
  let mockHealthCheckService: jest.Mocked<Partial<HealthCheckService>>;

  beforeEach(() => {
    mockHealthCheckService = {
      getMetricsText: jest.fn().mockResolvedValue(
        '# HELP orchestration_queue_depth Số job AI_ORCHESTRATION_QUEUE\n' +
        '# TYPE orchestration_queue_depth gauge\n' +
        'orchestration_queue_depth{state="waiting"} 0\n' +
        'orchestration_queue_depth{state="active"} 1\n'
      ),
    };

    controller = new MetricsController(mockHealthCheckService as HealthCheckService);
  });

  describe('GET /metrics', () => {
    it('returns prometheus text formatted metrics from HealthCheckService', async () => {
      const result = await controller.getMetrics();

      expect(mockHealthCheckService.getMetricsText).toHaveBeenCalledTimes(1);
      expect(result).toContain('orchestration_queue_depth');
      expect(result).toContain('orchestration_queue_depth{state="active"} 1');
    });

    it('has @BypassTransform metadata on the handler to prevent JSON enveloping', () => {
      const reflector = new Reflector();
      const isBypass = reflector.get<boolean>(
        BYPASS_TRANSFORM_KEY,
        controller.getMetrics,
      );

      expect(isBypass).toBe(true);
    });
  });
});
