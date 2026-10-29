import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiHeader,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { SkillCatalogService } from '../../../memory/skill/skill-catalog.service';
import { SkillNotFoundException } from '../../../common/errors/skill.exception';
import {
  CreateSkillDto,
  SkillResponseDto,
  SkillTenantQueryDto,
  UpdateSkillDto,
} from '../dtos/skill.dto';
import { ADMIN_API_KEY_HEADER, AdminApiKeyGuard } from '../guards/admin-api-key.guard';

@ApiTags('Skills')
@ApiHeader({ name: ADMIN_API_KEY_HEADER, required: true })
@UseGuards(AdminApiKeyGuard)
@Controller('api/skills')
export class SkillController {
  constructor(private readonly skills: SkillCatalogService) {}

  @Get()
  @ApiOperation({ summary: 'Liệt kê skill của một tenant (kể cả skill đã tắt)' })
  @ApiOkResponse({ type: [SkillResponseDto] })
  list(@Query() query: SkillTenantQueryDto): Promise<SkillResponseDto[]> {
    return this.skills.list(query.tenantId);
  }

  @Post()
  @ApiOperation({ summary: 'Tạo skill (playbook nghiệp vụ) mới' })
  @ApiCreatedResponse({ type: SkillResponseDto })
  @ApiConflictResponse({ description: 'Slug đã tồn tại trong tenant' })
  create(@Body() dto: CreateSkillDto): Promise<SkillResponseDto> {
    return this.skills.create(dto);
  }

  @Get(':slug')
  @ApiOperation({ summary: 'Lấy chi tiết skill theo slug (kể cả đã tắt)' })
  @ApiOkResponse({ type: SkillResponseDto })
  @ApiNotFoundResponse({ description: 'Không có skill với slug này' })
  async getBySlug(
    @Param('slug') slug: string,
    @Query() query: SkillTenantQueryDto,
  ): Promise<SkillResponseDto> {
    const skill = await this.skills.findBySlug(slug, query.tenantId);
    if (!skill) throw new SkillNotFoundException(slug);
    return skill;
  }

  @Put(':id')
  @ApiOperation({ summary: 'Cập nhật skill (các field bỏ trống giữ nguyên)' })
  @ApiOkResponse({ type: SkillResponseDto })
  @ApiNotFoundResponse({ description: 'Skill không tồn tại trong tenant' })
  @ApiConflictResponse({ description: 'Slug mới bị trùng trong tenant' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateSkillDto,
    @Query() query: SkillTenantQueryDto,
  ): Promise<SkillResponseDto> {
    return this.skills.update(id, dto, query.tenantId);
  }

  @Patch(':id/toggle')
  @ApiOperation({ summary: 'Bật/tắt skill (đảo trạng thái isActive)' })
  @ApiOkResponse({ type: SkillResponseDto })
  @ApiNotFoundResponse({ description: 'Skill không tồn tại trong tenant' })
  toggle(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: SkillTenantQueryDto,
  ): Promise<SkillResponseDto> {
    return this.skills.toggleActive(id, query.tenantId);
  }
}
