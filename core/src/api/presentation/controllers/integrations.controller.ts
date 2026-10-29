import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { IntegrationsService } from '../../application/integrations.service';
import {
  DisconnectIntegrationDto,
  GetIntegrationsStatusQueryDto,
  InitiateIntegrationQueryDto,
  InitiateIntegrationResponseDto,
  IntegrationActionResponseDto,
  IntegrationStatusItemDto,
  SubmitIntegrationCredentialsDto,
} from '../dtos/integrations.dto';

@ApiTags('Integrations')
@Controller('api/integrations')
export class IntegrationsController {
  constructor(private readonly integrationsService: IntegrationsService) {}

  @Get('status')
  @ApiOperation({
    summary: 'Lấy danh sách trạng thái kết nối các công cụ tích hợp',
    description: 'Trả về trạng thái kết nối OAuth2, Form DB và Native Tools theo chủ sở hữu (ownerId).',
  })
  @ApiOkResponse({ type: [IntegrationStatusItemDto] })
  async getStatus(
    @Query() query: GetIntegrationsStatusQueryDto,
  ): Promise<IntegrationStatusItemDto[]> {
    return this.integrationsService.getStatuses(query.ownerId);
  }

  @Get('initiate')
  @ApiOperation({
    summary: 'Khởi tạo quy trình kết nối (OAuth URL hoặc form fields)',
  })
  @ApiOkResponse({ type: InitiateIntegrationResponseDto })
  @ApiBadRequestResponse({ description: 'Provider không hợp lệ' })
  async initiate(
    @Query() query: InitiateIntegrationQueryDto,
  ): Promise<InitiateIntegrationResponseDto> {
    return this.integrationsService.initiate(query.provider, query.ownerId);
  }

  @Post('submit')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Lưu trữ thông tin đăng nhập/kết nối được mã hóa vào mcp_auth',
  })
  @ApiOkResponse({ type: IntegrationActionResponseDto })
  async submit(
    @Body() dto: SubmitIntegrationCredentialsDto,
  ): Promise<IntegrationActionResponseDto> {
    return this.integrationsService.submitCredentials(dto);
  }

  @Delete(':provider')
  @ApiOperation({
    summary: 'Hủy kết nối và thu hồi credential của một provider',
  })
  @ApiOkResponse({ type: IntegrationActionResponseDto })
  async disconnect(
    @Param('provider') provider: string,
    @Body() dto?: DisconnectIntegrationDto,
  ): Promise<IntegrationActionResponseDto> {
    return this.integrationsService.disconnect(provider, dto?.ownerId);
  }
}
