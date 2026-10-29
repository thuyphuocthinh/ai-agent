import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import {
  ISkillCatalogReader,
  ISkillPlaybookDetail,
} from '../../contracts/skill/skill-catalog-reader.interface';
import {
  SkillNotFoundException,
  SkillSlugConflictException,
} from '../../common/errors/skill.exception';
import {
  isPrismaUniqueViolation,
  sanitizePrismaError,
} from '../../common/errors/prisma-error.util';
import {
  CreateSkillInput,
  SkillRecord,
  UpdateSkillInput,
} from './skill.interface';
import { mapPrismaSkillToRecord } from './skill.mapper';
import { formatSkillCatalog } from './skill-catalog-format.util';

// Skill của tenant này hiển thị cho MỌI tenant (tenant ghi đè theo slug).
export const DEFAULT_SKILL_TENANT_ID = 'default';

// Skill = playbook nghiệp vụ do người quản trị tạo (KHÔNG tự học). Cung cấp
// Level 1 (catalog trong prompt) và Level 2 (đọc chi tiết theo slug) cho mọi engine.
@Injectable()
export class SkillCatalogService implements ISkillCatalogReader {
  private readonly logger = new Logger(SkillCatalogService.name);

  constructor(private readonly prisma: PrismaService) {}

  // Quản trị: mọi skill (kể cả đã tắt) của đúng tenant này.
  async list(tenantId = DEFAULT_SKILL_TENANT_ID): Promise<SkillRecord[]> {
    const skills = await this.prisma.skill.findMany({
      where: { tenantId },
      orderBy: { slug: 'asc' },
    });
    return skills.map(mapPrismaSkillToRecord);
  }

  // Quản trị: tra đúng tenant, không lọc isActive.
  async findBySlug(
    slug: string,
    tenantId = DEFAULT_SKILL_TENANT_ID,
  ): Promise<SkillRecord | null> {
    const skill = await this.prisma.skill.findUnique({
      where: { tenantId_slug: { tenantId, slug } },
    });
    return skill ? mapPrismaSkillToRecord(skill) : null;
  }

  async create(input: CreateSkillInput): Promise<SkillRecord> {
    const tenantId = input.tenantId ?? DEFAULT_SKILL_TENANT_ID;
    try {
      const saved = await this.prisma.skill.create({
        data: {
          tenantId,
          slug: input.slug,
          name: input.name,
          description: input.description,
          instructions: input.instructions,
          tools: input.tools ?? [],
          tags: input.tags ?? [],
          isActive: input.isActive ?? true,
          metadata: (input.metadata ?? {}) as Prisma.InputJsonObject,
        },
      });
      this.logger.log(`create() tenantId=${tenantId} slug="${input.slug}"`);
      return mapPrismaSkillToRecord(saved);
    } catch (error) {
      if (isPrismaUniqueViolation(error)) {
        throw new SkillSlugConflictException(input.slug, tenantId);
      }
      throw sanitizePrismaError(error, 'SkillCatalogService.create');
    }
  }

  async update(
    id: string,
    input: UpdateSkillInput,
    tenantId = DEFAULT_SKILL_TENANT_ID,
  ): Promise<SkillRecord> {
    await this.requireOwned(id, tenantId);
    try {
      const saved = await this.prisma.skill.update({
        where: { id },
        data: {
          slug: input.slug,
          name: input.name,
          description: input.description,
          instructions: input.instructions,
          tools: input.tools,
          tags: input.tags,
          isActive: input.isActive,
          metadata: input.metadata as Prisma.InputJsonObject | undefined,
        },
      });
      this.logger.log(`update() tenantId=${tenantId} id=${id}`);
      return mapPrismaSkillToRecord(saved);
    } catch (error) {
      if (isPrismaUniqueViolation(error)) {
        throw new SkillSlugConflictException(input.slug ?? id, tenantId);
      }
      throw sanitizePrismaError(error, 'SkillCatalogService.update');
    }
  }

  async toggleActive(
    id: string,
    tenantId = DEFAULT_SKILL_TENANT_ID,
  ): Promise<SkillRecord> {
    const existing = await this.requireOwned(id, tenantId);
    const saved = await this.prisma.skill
      .update({ where: { id }, data: { isActive: !existing.isActive } })
      .catch((error: unknown) => {
        throw sanitizePrismaError(error, 'SkillCatalogService.toggleActive');
      });
    this.logger.log(
      `toggleActive() tenantId=${tenantId} id=${id} isActive=${saved.isActive}`,
    );
    return mapPrismaSkillToRecord(saved);
  }

  // Level 2 — chỉ skill đang bật; skill của tenant ghi đè skill `default`.
  async getSkillBySlug(
    slug: string,
    tenantId = DEFAULT_SKILL_TENANT_ID,
  ): Promise<ISkillPlaybookDetail | null> {
    const skills = await this.prisma.skill.findMany({
      where: { slug, isActive: true, tenantId: { in: this.visibleTenants(tenantId) } },
    });
    const match =
      skills.find((s) => s.tenantId === tenantId) ??
      skills.find((s) => s.tenantId === DEFAULT_SKILL_TENANT_ID);
    return match ? mapPrismaSkillToRecord(match) : null;
  }

  // Skill đang bật hiển thị cho tenant: của tenant + `default`, tenant ghi đè
  // `default` theo slug, sắp theo slug. Dùng chung cho catalog và skill matcher.
  async listVisibleActive(
    tenantId = DEFAULT_SKILL_TENANT_ID,
  ): Promise<SkillRecord[]> {
    const skills = await this.prisma.skill.findMany({
      where: { isActive: true, tenantId: { in: this.visibleTenants(tenantId) } },
      orderBy: { slug: 'asc' },
    });

    const bySlug = new Map<string, (typeof skills)[number]>();
    for (const skill of skills) {
      const current = bySlug.get(skill.slug);
      if (!current || skill.tenantId === tenantId) bySlug.set(skill.slug, skill);
    }
    return [...bySlug.values()].map(mapPrismaSkillToRecord);
  }

  // Level 1 — chuỗi gọn (slug, name, description) cho prompt; '' nếu chưa có skill.
  // `excludeSlugs`: skill đã được nạp thẳng vào prompt thì không lặp lại ở catalog.
  async getCatalogForPrompt(
    tenantId = DEFAULT_SKILL_TENANT_ID,
    excludeSlugs: readonly string[] = [],
  ): Promise<string> {
    const excluded = new Set(excludeSlugs);
    const skills = await this.listVisibleActive(tenantId);
    return formatSkillCatalog(skills.filter((s) => !excluded.has(s.slug)));
  }

  private visibleTenants(tenantId: string): string[] {
    return tenantId === DEFAULT_SKILL_TENANT_ID
      ? [DEFAULT_SKILL_TENANT_ID]
      : [tenantId, DEFAULT_SKILL_TENANT_ID];
  }

  // Chặn thao tác chéo tenant: id không thuộc tenant này coi như không tồn tại.
  private async requireOwned(
    id: string,
    tenantId: string,
  ): Promise<SkillRecord> {
    const existing = await this.prisma.skill.findFirst({
      where: { id, tenantId },
    });
    if (!existing) throw new SkillNotFoundException(id);
    return mapPrismaSkillToRecord(existing);
  }
}
