import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ECheckpointRiskLevel } from '@agent/core/constants';
import { PrismaService } from '../infrastructure/database/prisma.service';
import { CreateSkillInput, SkillRecord, SkillStep } from './memory.interface';

export type SkillEntity = SkillRecord;

function isSkillStep(item: unknown): item is SkillStep {
  if (!item || typeof item !== 'object') return false;
  const candidate = item as Record<string, unknown>;
  return (
    typeof candidate.provider === 'string' &&
    typeof candidate.tool === 'string' &&
    typeof candidate.argsTemplate === 'object' &&
    candidate.argsTemplate !== null
  );
}

function parseSteps(value: Prisma.JsonValue): SkillStep[] {
  if (!Array.isArray(value)) return [];
  return (value as unknown[]).filter(isSkillStep);
}

function parseSourceCheckpointIds(value: Prisma.JsonValue): string[] {
  if (!Array.isArray(value)) return [];
  return (value as unknown[]).filter((id): id is string => typeof id === 'string');
}

function mapPrismaSkillToRecord(skill: {
  id: string;
  tenantId: string;
  taskDescription: string;
  summaryMarkdown: string;
  steps: Prisma.JsonValue;
  sourceCheckpointIds: Prisma.JsonValue;
  approvedRunCount: number;
  riskLevel: string | null;
  createdAt: Date;
  updatedAt: Date;
}): SkillRecord {
  return {
    id: skill.id,
    tenantId: skill.tenantId,
    workspaceId: skill.tenantId,
    taskDescription: skill.taskDescription,
    summaryMarkdown: skill.summaryMarkdown,
    steps: parseSteps(skill.steps),
    sourceCheckpointIds: parseSourceCheckpointIds(skill.sourceCheckpointIds),
    approvedRunCount: skill.approvedRunCount,
    riskLevel: (skill.riskLevel as ECheckpointRiskLevel) ?? null,
    createdAt: skill.createdAt,
    updatedAt: skill.updatedAt,
  };
}

@Injectable()
export class SkillService {
  private readonly logger = new Logger(SkillService.name);

  constructor(private readonly prisma: PrismaService) {}

  async findByTenant(tenantId: string): Promise<SkillRecord[]> {
    const skills = await this.prisma.skill.findMany({
      where: { tenantId },
    });
    return skills.map(mapPrismaSkillToRecord);
  }

  async findByWorkspace(workspaceId: string): Promise<SkillRecord[]> {
    return this.findByTenant(workspaceId);
  }

  async create(input: CreateSkillInput): Promise<SkillRecord> {
    const tenantId = input.workspaceId;
    const stepsJson = input.steps as unknown as Prisma.InputJsonValue;
    const sourceIdsJson = [input.sourceCheckpointId] as unknown as Prisma.InputJsonValue;

    const saved = await this.prisma.skill.create({
      data: {
        tenantId,
        taskDescription: input.taskDescription,
        summaryMarkdown: input.summaryMarkdown,
        steps: stepsJson,
        sourceCheckpointIds: sourceIdsJson,
        riskLevel: input.riskLevel,
      },
    });

    this.logger.log(
      `create() tenantId=${tenantId} taskDescription="${input.taskDescription}"`,
    );
    return mapPrismaSkillToRecord(saved);
  }

  // Gộp thêm 1 lần chạy đúng nữa vào skill đã có — KHÔNG ghi đè steps cũ,
  // giữ nguyên chuỗi bước đã chứng minh đúng lần đầu.
  async incrementApprovedRunCount(
    skillId: string,
    sourceCheckpointId: string,
  ): Promise<void> {
    const existing = await this.prisma.skill.findUnique({
      where: { id: skillId },
    });
    if (!existing) return;

    const sourceIds = parseSourceCheckpointIds(existing.sourceCheckpointIds);
    await this.prisma.skill.update({
      where: { id: skillId },
      data: {
        approvedRunCount: existing.approvedRunCount + 1,
        sourceCheckpointIds: [
          ...sourceIds,
          sourceCheckpointId,
        ] as unknown as Prisma.InputJsonValue,
      },
    });
  }
}
