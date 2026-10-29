import { Test, TestingModule } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import {
  SkillNotFoundException,
  SkillSlugConflictException,
} from '../../common/errors/skill.exception';
import {
  DEFAULT_SKILL_TENANT_ID,
  SkillCatalogService,
} from './skill-catalog.service';

function buildRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'skill-1',
    tenantId: 'tenant-a',
    slug: 'hotel-cancellation',
    name: 'Hotel Cancellation',
    description: 'Quy trình hủy đặt phòng khách sạn',
    instructions: '# Playbook\n1. Kiểm tra booking',
    tools: ['cancel_booking'],
    tags: ['hotel'],
    isActive: true,
    metadata: {},
    createdAt: new Date('2026-10-29T00:00:00Z'),
    updatedAt: new Date('2026-10-29T00:00:00Z'),
    ...overrides,
  };
}

function uniqueViolation(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: 'test',
  });
}

describe('SkillCatalogService', () => {
  let service: SkillCatalogService;

  const mockPrisma = {
    skill: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SkillCatalogService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();
    service = module.get(SkillCatalogService);
  });

  afterEach(() => jest.resetAllMocks());

  describe('list / findBySlug (quản trị, đúng tenant)', () => {
    it('lists every skill of exactly one tenant, including inactive ones', async () => {
      mockPrisma.skill.findMany.mockResolvedValue([
        buildRow(),
        buildRow({ id: 'skill-2', slug: 'b', isActive: false }),
      ]);

      const result = await service.list('tenant-a');

      expect(mockPrisma.skill.findMany).toHaveBeenCalledWith({
        where: { tenantId: 'tenant-a' },
        orderBy: { slug: 'asc' },
      });
      expect(result.map((s) => s.slug)).toEqual(['hotel-cancellation', 'b']);
    });

    it('finds by the (tenantId, slug) unique key without filtering isActive', async () => {
      mockPrisma.skill.findUnique.mockResolvedValue(buildRow({ isActive: false }));

      const result = await service.findBySlug('hotel-cancellation', 'tenant-a');

      expect(mockPrisma.skill.findUnique).toHaveBeenCalledWith({
        where: {
          tenantId_slug: { tenantId: 'tenant-a', slug: 'hotel-cancellation' },
        },
      });
      expect(result?.isActive).toBe(false);
    });

    it('returns null when the slug does not exist in that tenant', async () => {
      mockPrisma.skill.findUnique.mockResolvedValue(null);

      await expect(service.findBySlug('nope', 'tenant-a')).resolves.toBeNull();
    });
  });

  describe('create', () => {
    it('persists the skill with defaults for omitted optional fields', async () => {
      mockPrisma.skill.create.mockResolvedValue(buildRow({ tenantId: 'default' }));

      const result = await service.create({
        slug: 'hotel-cancellation',
        name: 'Hotel Cancellation',
        description: 'Quy trình hủy đặt phòng khách sạn',
        instructions: '# Playbook',
      });

      expect(mockPrisma.skill.create).toHaveBeenCalledWith({
        data: {
          tenantId: DEFAULT_SKILL_TENANT_ID,
          slug: 'hotel-cancellation',
          name: 'Hotel Cancellation',
          description: 'Quy trình hủy đặt phòng khách sạn',
          instructions: '# Playbook',
          tools: [],
          tags: [],
          isActive: true,
          metadata: {},
        },
      });
      expect(result.slug).toBe('hotel-cancellation');
    });

    it('throws SkillSlugConflictException when (tenantId, slug) already exists', async () => {
      mockPrisma.skill.create.mockRejectedValue(uniqueViolation());

      await expect(
        service.create({
          tenantId: 'tenant-a',
          slug: 'hotel-cancellation',
          name: 'n',
          description: 'd',
          instructions: 'i',
        }),
      ).rejects.toBeInstanceOf(SkillSlugConflictException);
    });
  });

  describe('update', () => {
    it('updates only a skill that belongs to the given tenant', async () => {
      mockPrisma.skill.findFirst.mockResolvedValue(buildRow());
      mockPrisma.skill.update.mockResolvedValue(buildRow({ name: 'Mới' }));

      const result = await service.update('skill-1', { name: 'Mới' }, 'tenant-a');

      expect(mockPrisma.skill.findFirst).toHaveBeenCalledWith({
        where: { id: 'skill-1', tenantId: 'tenant-a' },
      });
      expect(mockPrisma.skill.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'skill-1' } }),
      );
      expect(result.name).toBe('Mới');
    });

    it('treats a skill of another tenant as not found (tenant isolation)', async () => {
      mockPrisma.skill.findFirst.mockResolvedValue(null);

      await expect(
        service.update('skill-1', { name: 'x' }, 'tenant-b'),
      ).rejects.toBeInstanceOf(SkillNotFoundException);
      expect(mockPrisma.skill.update).not.toHaveBeenCalled();
    });

    it('throws SkillSlugConflictException when the new slug collides in the same tenant', async () => {
      mockPrisma.skill.findFirst.mockResolvedValue(buildRow());
      mockPrisma.skill.update.mockRejectedValue(uniqueViolation());

      await expect(
        service.update('skill-1', { slug: 'taken' }, 'tenant-a'),
      ).rejects.toBeInstanceOf(SkillSlugConflictException);
    });
  });

  describe('toggleActive', () => {
    it('flips isActive of a skill in the given tenant', async () => {
      mockPrisma.skill.findFirst.mockResolvedValue(buildRow({ isActive: true }));
      mockPrisma.skill.update.mockResolvedValue(buildRow({ isActive: false }));

      const result = await service.toggleActive('skill-1', 'tenant-a');

      expect(mockPrisma.skill.update).toHaveBeenCalledWith({
        where: { id: 'skill-1' },
        data: { isActive: false },
      });
      expect(result.isActive).toBe(false);
    });

    it('throws SkillNotFoundException for a skill outside the tenant', async () => {
      mockPrisma.skill.findFirst.mockResolvedValue(null);

      await expect(
        service.toggleActive('skill-1', 'tenant-b'),
      ).rejects.toBeInstanceOf(SkillNotFoundException);
    });
  });

  describe('getSkillBySlug (Level 2)', () => {
    it('queries only active skills of the tenant and the shared default tenant', async () => {
      mockPrisma.skill.findMany.mockResolvedValue([buildRow()]);

      await service.getSkillBySlug('hotel-cancellation', 'tenant-a');

      expect(mockPrisma.skill.findMany).toHaveBeenCalledWith({
        where: {
          slug: 'hotel-cancellation',
          isActive: true,
          tenantId: { in: ['tenant-a', 'default'] },
        },
      });
    });

    it('prefers the tenant skill over the default skill with the same slug', async () => {
      mockPrisma.skill.findMany.mockResolvedValue([
        buildRow({ id: 'd', tenantId: 'default', instructions: 'default' }),
        buildRow({ id: 't', tenantId: 'tenant-a', instructions: 'tenant' }),
      ]);

      const result = await service.getSkillBySlug('hotel-cancellation', 'tenant-a');

      expect(result?.instructions).toBe('tenant');
    });

    it('falls back to the default skill when the tenant has none', async () => {
      mockPrisma.skill.findMany.mockResolvedValue([
        buildRow({ id: 'd', tenantId: 'default', instructions: 'default' }),
      ]);

      const result = await service.getSkillBySlug('hotel-cancellation', 'tenant-a');

      expect(result?.instructions).toBe('default');
    });

    it('returns null when no active skill matches (missing or inactive)', async () => {
      mockPrisma.skill.findMany.mockResolvedValue([]);

      await expect(
        service.getSkillBySlug('nope', 'tenant-a'),
      ).resolves.toBeNull();
    });
  });

  describe('listVisibleActive (dùng chung cho catalog và matcher)', () => {
    it('queries only active skills of the tenant and the default tenant, ordered by slug', async () => {
      mockPrisma.skill.findMany.mockResolvedValue([]);

      await service.listVisibleActive('tenant-a');

      expect(mockPrisma.skill.findMany).toHaveBeenCalledWith({
        where: { isActive: true, tenantId: { in: ['tenant-a', 'default'] } },
        orderBy: { slug: 'asc' },
      });
    });

    it('only looks at the default tenant when asked for the default tenant', async () => {
      mockPrisma.skill.findMany.mockResolvedValue([]);

      await service.listVisibleActive();

      expect(mockPrisma.skill.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { isActive: true, tenantId: { in: ['default'] } },
        }),
      );
    });

    it('lets a tenant skill override the default skill with the same slug', async () => {
      mockPrisma.skill.findMany.mockResolvedValue([
        buildRow({ id: 'd', tenantId: 'default', name: 'Default Name' }),
        buildRow({ id: 't', tenantId: 'tenant-a', name: 'Tenant Name' }),
        buildRow({ id: 'o', tenantId: 'default', slug: 'other' }),
      ]);

      const result = await service.listVisibleActive('tenant-a');

      expect(result.map((s) => [s.id, s.name])).toEqual([
        ['t', 'Tenant Name'],
        ['o', 'Hotel Cancellation'],
      ]);
    });

    it('maps rows to SkillRecord including metadata and updatedAt', async () => {
      mockPrisma.skill.findMany.mockResolvedValue([
        buildRow({ metadata: { autoLoad: false } }),
      ]);

      const [skill] = await service.listVisibleActive('tenant-a');

      expect(skill.metadata).toEqual({ autoLoad: false });
      expect(skill.updatedAt).toEqual(new Date('2026-10-29T00:00:00Z'));
    });
  });

  describe('getCatalogForPrompt (Level 1)', () => {
    it('returns an empty string when there is no active skill', async () => {
      mockPrisma.skill.findMany.mockResolvedValue([]);

      await expect(service.getCatalogForPrompt('tenant-a')).resolves.toBe('');
    });

    it('queries only active skills of the tenant and the default tenant', async () => {
      mockPrisma.skill.findMany.mockResolvedValue([]);

      await service.getCatalogForPrompt('tenant-a');

      expect(mockPrisma.skill.findMany).toHaveBeenCalledWith({
        where: { isActive: true, tenantId: { in: ['tenant-a', 'default'] } },
        orderBy: { slug: 'asc' },
      });
    });

    it('lists slug, name and description but never the instructions', async () => {
      mockPrisma.skill.findMany.mockResolvedValue([buildRow()]);

      const catalog = await service.getCatalogForPrompt('tenant-a');

      expect(catalog).toContain('read_skill');
      expect(catalog).toContain(
        '- hotel-cancellation (Hotel Cancellation): Quy trình hủy đặt phòng khách sạn',
      );
      expect(catalog).not.toContain('Kiểm tra booking');
    });

    it('lets a tenant skill override the default skill with the same slug', async () => {
      mockPrisma.skill.findMany.mockResolvedValue([
        buildRow({ tenantId: 'default', name: 'Default Name' }),
        buildRow({ tenantId: 'tenant-a', name: 'Tenant Name' }),
      ]);

      const catalog = await service.getCatalogForPrompt('tenant-a');

      expect(catalog).toContain('Tenant Name');
      expect(catalog).not.toContain('Default Name');
    });

    it('truncates long descriptions to a single short line', async () => {
      mockPrisma.skill.findMany.mockResolvedValue([
        buildRow({ description: `dòng 1\ndòng 2 ${'x'.repeat(300)}` }),
      ]);

      const catalog = await service.getCatalogForPrompt('tenant-a');
      const entry = catalog.split('\n').find((l) => l.startsWith('- hotel'));

      expect(entry).toBeDefined();
      expect(entry).toContain('…');
      expect(entry!.length).toBeLessThan(140);
    });

    it('leaves out the skills listed in excludeSlugs (already auto-loaded into the prompt)', async () => {
      mockPrisma.skill.findMany.mockResolvedValue([
        buildRow({ id: 'a', slug: 'sql-safe-write', name: 'SQL Safe Write' }),
        buildRow({ id: 'b', slug: 'incident-notify', name: 'Incident Notify' }),
      ]);

      const catalog = await service.getCatalogForPrompt('tenant-a', ['sql-safe-write']);

      expect(catalog).not.toContain('sql-safe-write');
      expect(catalog).toContain('incident-notify');
    });

    it('returns an empty string when every visible skill is excluded', async () => {
      mockPrisma.skill.findMany.mockResolvedValue([
        buildRow({ slug: 'sql-safe-write' }),
      ]);

      await expect(
        service.getCatalogForPrompt('tenant-a', ['sql-safe-write']),
      ).resolves.toBe('');
    });

    it('keeps the entry section within budget and lists overflow skills as slug only', async () => {
      const rows = Array.from({ length: 30 }, (_, i) =>
        buildRow({
          id: `s-${i}`,
          slug: `skill-${String(i).padStart(2, '0')}`,
          name: `Skill ${i}`,
          description: 'mô tả khá dài để tốn ngân sách '.repeat(3),
        }),
      );
      mockPrisma.skill.findMany.mockResolvedValue(rows);

      const catalog = await service.getCatalogForPrompt('tenant-a');
      const detailedLines = catalog
        .split('\n')
        .filter((l) => l.startsWith('- skill-'));
      const detailedChars = detailedLines.reduce((n, l) => n + l.length, 0);

      expect(detailedChars).toBeLessThanOrEqual(600);
      expect(detailedLines.length).toBeLessThan(30);
      expect(catalog).toContain('Skill khác (chỉ slug):');
      expect(catalog).toContain('skill-29');
    });
  });
});
