import {
  CATALOG_ENTRY_CHAR_BUDGET,
  formatSkillCatalog,
} from './skill-catalog-format.util';
import { SkillRecord } from './skill.interface';

function skill(overrides: Partial<SkillRecord> = {}): SkillRecord {
  return {
    id: 'skill-1',
    tenantId: 'default',
    slug: 'hotel-cancellation',
    name: 'Hotel Cancellation',
    description: 'Quy trình hủy đặt phòng khách sạn',
    instructions: 'KHÔNG ĐƯỢC LỘ NỘI DUNG NÀY',
    tools: [],
    tags: [],
    isActive: true,
    metadata: {},
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe('formatSkillCatalog', () => {
  it('returns an empty string when there is no skill', () => {
    expect(formatSkillCatalog([])).toBe('');
  });

  it('lists slug, name and description under a header that points to read_skill', () => {
    const catalog = formatSkillCatalog([skill()]);

    expect(catalog).toContain('read_skill');
    expect(catalog).toContain(
      '- hotel-cancellation (Hotel Cancellation): Quy trình hủy đặt phòng khách sạn',
    );
  });

  it('never exposes the instructions', () => {
    expect(formatSkillCatalog([skill()])).not.toContain('KHÔNG ĐƯỢC LỘ');
  });

  it('truncates long descriptions to one short line', () => {
    const catalog = formatSkillCatalog([
      skill({ description: `dòng 1\ndòng 2 ${'x'.repeat(300)}` }),
    ]);
    const entry = catalog.split('\n').find((l) => l.startsWith('- hotel'));

    expect(entry).toContain('…');
    expect(entry!.length).toBeLessThan(140);
  });

  it('keeps the entries within budget and lists overflow skills by slug only', () => {
    const skills = Array.from({ length: 30 }, (_, i) =>
      skill({
        id: `s-${i}`,
        slug: `skill-${String(i).padStart(2, '0')}`,
        name: `Skill ${i}`,
        description: 'mô tả khá dài để tốn ngân sách '.repeat(3),
      }),
    );

    const catalog = formatSkillCatalog(skills);
    const entryChars = catalog
      .split('\n')
      .filter((l) => l.startsWith('- skill-'))
      .reduce((n, l) => n + l.length, 0);

    expect(entryChars).toBeLessThanOrEqual(CATALOG_ENTRY_CHAR_BUDGET);
    expect(catalog).toContain('Skill khác (chỉ slug):');
    expect(catalog).toContain('skill-29');
  });
});
