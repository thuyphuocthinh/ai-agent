import { SkillRecord } from './skill.interface';

// Văn bản dùng để embed một skill: tên + mô tả + nhãn + triggers mẫu (KHÔNG gồm `instructions`,
// vốn dài và chỉ mô tả cách làm chứ không mô tả khi nào dùng).
export function buildSkillEmbeddingText(
  skill: Pick<SkillRecord, 'name' | 'description' | 'tags'> & {
    metadata?: Record<string, unknown> | null;
  },
): string {
  const tags = skill.tags.length > 0 ? `. ${skill.tags.join(', ')}` : '';
  const triggersList = Array.isArray(skill.metadata?.triggers)
    ? (skill.metadata.triggers as unknown[]).filter(
        (t): t is string => typeof t === 'string' && t.trim().length > 0,
      )
    : [];
  const triggers =
    triggersList.length > 0 ? `. Các câu lệnh mẫu: ${triggersList.join('; ')}` : '';
  return `${skill.name}. ${skill.description}${tags}${triggers}`;
}
