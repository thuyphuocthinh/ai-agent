import { truncateToSingleLine } from '../../common/text/truncate.util';
import { SkillRecord } from './skill.interface';

// Ngân sách ký tự cho phần entry đầy đủ của catalog (~150 token). Skill nào
// vượt ngân sách chỉ liệt kê slug — model vẫn đọc được qua read_skill.
export const CATALOG_ENTRY_CHAR_BUDGET = 600;
export const CATALOG_DESCRIPTION_MAX_CHARS = 80;

const CATALOG_HEADER =
  'Các skill (playbook nghiệp vụ) có sẵn. Nếu yêu cầu của người dùng liên quan tới một skill dưới đây, bạn BẮT BUỘC gọi tool read_skill({ slug }) để đọc playbook TRƯỚC khi gọi bất kỳ tool nào khác, rồi làm đúng theo playbook:';

// Level 1 — chuỗi gọn (slug, name, mô tả cắt ngắn) cho prompt; '' nếu không có skill.
export function formatSkillCatalog(skills: readonly SkillRecord[]): string {
  if (skills.length === 0) return '';

  const detailed: string[] = [];
  const slugOnly: string[] = [];
  let usedChars = 0;
  for (const skill of skills) {
    const description = truncateToSingleLine(
      skill.description,
      CATALOG_DESCRIPTION_MAX_CHARS,
    );
    const line = `- ${skill.slug} (${skill.name}): ${description}`;
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
