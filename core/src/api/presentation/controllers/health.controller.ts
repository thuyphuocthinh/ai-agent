import {
  Controller,
  Get,
  HttpStatus,
  Res,
} from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { HealthCheckService } from '../../../infrastructure/resilience/health-check.service';
import { HealthCheckResponseDto } from '../../../contracts/dtos/orchestration.dto';

export interface IHttpResponse {
  status?(statusCode: number): unknown;
}

/**
 * Controller kiểm tra trạng thái sức khỏe hệ thống (Liveness & Readiness Probes).
 * Dành cho Docker, Kubernetes và Load Balancer giám sát tính sẵn sàng.
 */
@ApiTags('Observability')
@Controller('health')
export class HealthController {
  constructor(private readonly healthCheckService: HealthCheckService) {}

  @Get()
  @ApiOperation({
    summary: 'Kiểm tra sức khỏe hệ thống (Liveness & Readiness Probe)',
    description:
      'Đánh giá kết nối tới PostgreSQL, Redis và trạng thái hàng đợi BullMQ. Trả về HTTP 200 nếu sẵn sàng hoặc HTTP 503 nếu có dịch vụ thành phần bị gián đoạn.',
  })
  @ApiOkResponse({
    description: 'Hệ thống hoạt động bình thường',
    type: HealthCheckResponseDto,
  })
  @ApiResponse({
    status: HttpStatus.SERVICE_UNAVAILABLE,
    description: 'Hệ thống ở trạng thái suy giảm (Database hoặc Redis gián đoạn)',
    type: HealthCheckResponseDto,
  })
  async check(
    @Res({ passthrough: true }) response?: IHttpResponse,
  ): Promise<HealthCheckResponseDto> {
    const result = await this.healthCheckService.check();

    if (result.status === 'degraded' && response?.status) {
      response.status(HttpStatus.SERVICE_UNAVAILABLE);
    }

    return result;
  }
}
