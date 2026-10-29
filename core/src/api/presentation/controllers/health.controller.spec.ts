import { HttpStatus } from '@nestjs/common';
import { HealthController, type IHttpResponse } from './health.controller';
import { HealthCheckService } from '../../../infrastructure/resilience/health-check.service';
import type { HealthCheckResponseDto } from '../../../contracts/dtos/orchestration.dto';

describe('HealthController', () => {
  let controller: HealthController;
  let mockHealthCheckService: jest.Mocked<Partial<HealthCheckService>>;

  beforeEach(() => {
    mockHealthCheckService = {
      check: jest.fn(),
    };

    controller = new HealthController(
      mockHealthCheckService as HealthCheckService,
    );
  });

  describe('GET /health', () => {
    it('returns 200 with status "ok" when all downstream services are healthy', async () => {
      const healthyResult: HealthCheckResponseDto = {
        status: 'ok',
        redis: true,
        database: true,
        circuitBreakers: { 'mcp:tool': 'closed' },
        queueDepth: { waiting: 0, active: 0 },
      };
      mockHealthCheckService.check!.mockResolvedValue(healthyResult);

      const mockResponse: IHttpResponse = {
        status: jest.fn(),
      };

      const result = await controller.check(mockResponse);

      expect(result).toEqual(healthyResult);
      expect(mockResponse.status).not.toHaveBeenCalled();
    });

    it('sets HTTP 503 Service Unavailable when downstream services are degraded', async () => {
      const degradedResult: HealthCheckResponseDto = {
        status: 'degraded',
        redis: false,
        database: true,
        circuitBreakers: { 'mcp:tool': 'closed' },
        queueDepth: { waiting: 5, active: 0 },
      };
      mockHealthCheckService.check!.mockResolvedValue(degradedResult);

      const mockResponse: IHttpResponse = {
        status: jest.fn(),
      };

      const result = await controller.check(mockResponse);

      expect(result).toEqual(degradedResult);
      expect(mockResponse.status).toHaveBeenCalledWith(
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    });

    it('works without response object without throwing', async () => {
      const healthyResult: HealthCheckResponseDto = {
        status: 'ok',
        redis: true,
        database: true,
        circuitBreakers: {},
        queueDepth: {},
      };
      mockHealthCheckService.check!.mockResolvedValue(healthyResult);

      const result = await controller.check();
      expect(result.status).toBe('ok');
    });
  });
});
