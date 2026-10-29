import { Prisma } from '@prisma/client';
import { SkillRecord } from './skill.interface';

interface PrismaSkillRow {
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
}

export function mapPrismaSkillToRecord(skill: PrismaSkillRow): SkillRecord {
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
