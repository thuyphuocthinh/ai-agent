import { SkillRecord } from './skill.interface';

// Văn bản dùng để embed một skill: tên + mô tả + nhãn (KHÔNG gồm `instructions`,
// vốn dài và chỉ mô tả cách làm chứ không mô tả khi nào dùng).
export function buildSkillEmbeddingText(
  skill: Pick<SkillRecord, 'name' | 'description' | 'tags'>,
): string {
  const tags = skill.tags.length > 0 ? `. ${skill.tags.join(', ')}` : '';
  return `${skill.name}. ${skill.description}${tags}`;
}
