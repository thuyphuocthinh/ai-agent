import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateSkillDto, UpdateSkillDto } from './skill.dto';

const valid = {
  slug: 'hotel-cancellation',
  name: 'Hotel Cancellation',
  description: 'mô tả',
  instructions: '# Playbook',
};

async function errorsOf<T extends object>(cls: new () => T, payload: object) {
  const errors = await validate(plainToInstance(cls, payload));
  return errors.map((e) => e.property);
}

describe('Skill DTO validation', () => {
  it('accepts a minimal valid create payload', async () => {
    expect(await errorsOf(CreateSkillDto, valid)).toEqual([]);
  });

  it.each(['Hotel Cancellation', 'UPPER', 'a_b', '-a', 'a-', 'a--b', ''])(
    'rejects slug %j that is not lower-case kebab-case',
    async (slug) => {
      expect(await errorsOf(CreateSkillDto, { ...valid, slug })).toContain('slug');
    },
  );

  it.each(['slug', 'name', 'description', 'instructions'])(
    'requires %s on create',
    async (field) => {
      const payload: Record<string, unknown> = { ...valid };
      delete payload[field];

      expect(await errorsOf(CreateSkillDto, payload)).toContain(field);
    },
  );

  it('rejects wrong types for optional fields', async () => {
    const errors = await errorsOf(CreateSkillDto, {
      ...valid,
      tools: 'not-an-array',
      isActive: 'yes',
      metadata: 'x',
    });

    expect(errors).toEqual(expect.arrayContaining(['tools', 'isActive', 'metadata']));
  });

  it('rejects a name longer than 150 chars', async () => {
    expect(
      await errorsOf(CreateSkillDto, { ...valid, name: 'x'.repeat(151) }),
    ).toContain('name');
  });

  it('allows an empty update payload (all fields optional) but still validates provided ones', async () => {
    expect(await errorsOf(UpdateSkillDto, {})).toEqual([]);
    expect(await errorsOf(UpdateSkillDto, { slug: 'Bad Slug' })).toContain('slug');
  });
});
