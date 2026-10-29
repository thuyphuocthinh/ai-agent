import 'reflect-metadata';
import { SkillController } from './skill.controller';
import { SkillCatalogService } from '../../../memory/skill/skill-catalog.service';
import { SkillNotFoundException } from '../../../common/errors/skill.exception';
import { AdminApiKeyGuard } from '../guards/admin-api-key.guard';

describe('SkillController', () => {
  const mockSkills = {
    list: jest.fn(),
    create: jest.fn(),
    findBySlug: jest.fn(),
    update: jest.fn(),
    toggleActive: jest.fn(),
  };
  const controller = new SkillController(
    mockSkills as unknown as SkillCatalogService,
  );

  const skill = { id: 'skill-1', slug: 'hotel-cancellation', tenantId: 'default' };
  const uuid = '018f23a5-7b12-7000-8000-123456789abc';

  afterEach(() => jest.resetAllMocks());

  it('is protected by AdminApiKeyGuard at controller level (every endpoint)', () => {
    const guards = Reflect.getMetadata('__guards__', SkillController) as unknown[];

    expect(guards).toContain(AdminApiKeyGuard);
  });

  it('serves under /api/skills', () => {
    expect(Reflect.getMetadata('path', SkillController)).toBe('api/skills');
  });

  it('lists skills of the requested tenant', async () => {
    mockSkills.list.mockResolvedValue([skill]);

    await expect(controller.list({ tenantId: 'tenant-a' })).resolves.toEqual([skill]);
    expect(mockSkills.list).toHaveBeenCalledWith('tenant-a');
  });

  it('lets the service default the tenant when none is given', async () => {
    mockSkills.list.mockResolvedValue([]);

    await controller.list({});

    expect(mockSkills.list).toHaveBeenCalledWith(undefined);
  });

  it('delegates creation to the service', async () => {
    const dto = {
      slug: 'hotel-cancellation',
      name: 'Hotel',
      description: 'd',
      instructions: 'i',
    };
    mockSkills.create.mockResolvedValue(skill);

    await expect(controller.create(dto)).resolves.toBe(skill);
    expect(mockSkills.create).toHaveBeenCalledWith(dto);
  });

  it('returns a skill by slug within the tenant', async () => {
    mockSkills.findBySlug.mockResolvedValue(skill);

    await expect(
      controller.getBySlug('hotel-cancellation', { tenantId: 'tenant-a' }),
    ).resolves.toBe(skill);
    expect(mockSkills.findBySlug).toHaveBeenCalledWith('hotel-cancellation', 'tenant-a');
  });

  it('throws SkillNotFoundException (404) when the slug does not exist', async () => {
    mockSkills.findBySlug.mockResolvedValue(null);

    await expect(controller.getBySlug('nope', {})).rejects.toBeInstanceOf(
      SkillNotFoundException,
    );
  });

  it('delegates update with the id, body and tenant', async () => {
    mockSkills.update.mockResolvedValue(skill);

    await controller.update(uuid, { name: 'Mới' }, { tenantId: 'tenant-a' });

    expect(mockSkills.update).toHaveBeenCalledWith(uuid, { name: 'Mới' }, 'tenant-a');
  });

  it('delegates toggle with the id and tenant', async () => {
    mockSkills.toggleActive.mockResolvedValue(skill);

    await controller.toggle(uuid, { tenantId: 'tenant-a' });

    expect(mockSkills.toggleActive).toHaveBeenCalledWith(uuid, 'tenant-a');
  });
});
