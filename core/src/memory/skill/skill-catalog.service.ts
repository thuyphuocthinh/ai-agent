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
import { sanitizePrismaError } from '../../common/errors/prisma-error.util';
import {
  CreateSkillInput,
  SkillRecord,
  UpdateSkillInput,
} from './skill.interface';

// Skill của tenant này hiển thị cho MỌI tenant (tenant ghi đè theo slug).
export const DEFAULT_SKILL_TENANT_ID = 'default';

// Ngân sách ký tự cho phần entry đầy đủ của catalog (~150 token). Skill nào
// vượt ngân sách chỉ liệt kê slug — model vẫn đọc được qua read_skill.
const CATALOG_ENTRY_CHAR_BUDGET = 600;
const CATALOG_DESCRIPTION_MAX_CHARS = 80;

const CATALOG_HEADER =
  'Các skill (playbook nghiệp vụ) có sẵn. Nếu yêu cầu của người dùng liên quan tới một skill dưới đây, bạn BẮT BUỘC gọi tool read_skill({ slug }) để đọc playbook TRƯỚC khi gọi bất kỳ tool nào khác, rồi làm đúng theo playbook:';

function mapPrismaSkillToRecord(skill: {
  id: string;
  tenantId: string;
  slug: string;
  name: string;
  description: string;
  instructions: string;
  tools: string[];
  tags: string[];
  isActive: boolean;
  metadata: Prisma.JsonValue;
  createdAt: Date;
  updatedAt: Date;
}): SkillRecord {
  return {
    id: skill.id,
    tenantId: skill.tenantId,
    slug: skill.slug,
    name: skill.name,
    description: skill.description,
    instructions: skill.instructions,
    tools: skill.tools,
    tags: skill.tags,
    isActive: skill.isActive,
    metadata: (skill.metadata ?? {}) as Record<string, unknown>,
    createdAt: skill.createdAt,
    updatedAt: skill.updatedAt,
  };
}

function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002'
  );
}

function truncate(text: string, maxChars: number): string {
  const singleLine = text.replace(/\s+/g, ' ').trim();
  return singleLine.length > maxChars
    ? `${singleLine.slice(0, maxChars - 1)}…`
    : singleLine;
}

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
      if (isUniqueViolation(error)) {
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
      if (isUniqueViolation(error)) {
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

  // Level 1 — chuỗi gọn (slug, name, description) cho prompt; '' nếu chưa có skill.
  async getCatalogForPrompt(
    tenantId = DEFAULT_SKILL_TENANT_ID,
  ): Promise<string> {
    const skills = await this.prisma.skill.findMany({
      where: { isActive: true, tenantId: { in: this.visibleTenants(tenantId) } },
      orderBy: { slug: 'asc' },
    });

    const bySlug = new Map<string, (typeof skills)[number]>();
    for (const skill of skills) {
      const current = bySlug.get(skill.slug);
      if (!current || skill.tenantId === tenantId) bySlug.set(skill.slug, skill);
    }
    if (bySlug.size === 0) return '';

    const detailed: string[] = [];
    const slugOnly: string[] = [];
    let usedChars = 0;
    for (const skill of bySlug.values()) {
      const line = `- ${skill.slug} (${skill.name}): ${truncate(skill.description, CATALOG_DESCRIPTION_MAX_CHARS)}`;
      if (usedChars + line.length <= CATALOG_ENTRY_CHAR_BUDGET) {
        detailed.push(line);
        usedChars += line.length;
      } else {
        slugOnly.push(skill.slug);
      }
    }

    const parts = [CATALOG_HEADER, ...detailed];
    if (slugOnly.length > 0) {
      parts.push(`- Skill khác (chỉ slug): ${slugOnly.join(', ')}`);
    }
    return parts.join('\n');
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
