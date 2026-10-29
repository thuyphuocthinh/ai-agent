import {
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiProduces,
  ApiTags,
} from '@nestjs/swagger';
import { BypassTransform } from '../decorators/bypass-transform.decorator';
import { HealthCheckService } from '../../../infrastructure/resilience/health-check.service';

/**
 * Controller phục vụ cào dữ liệu Prometheus Metrics (Prometheus Pull Scrape).
 * Tuân thủ định dạng text chuẩn Prometheus (0.0.4).
 */
@ApiTags('Observability')
@Controller('metrics')
export class MetricsController {
  constructor(private readonly healthCheckService: HealthCheckService) {}

  @Get()
  @BypassTransform()
  @HttpCode(HttpStatus.OK)
  @Header('Content-Type', 'text/plain; version=0.0.4')
  @ApiOperation({
    summary: 'Prometheus Metrics Exposition Endpoint',
    description:
      'Xuất số liệu thống kê thời gian thực (queue depth, circuit breakers, behavior signals) theo chuẩn Prometheus.',
  })
  @ApiProduces('text/plain')
  @ApiOkResponse({
    description: 'Prometheus exposition text format metrics',
    schema: { type: 'string' },
  })
  async getMetrics(): Promise<string> {
    return this.healthCheckService.getMetricsText();
  }
}
