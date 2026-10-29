import { ISkillMatch } from '../../../contracts/skill/skill-matcher.interface';

export interface SkillPlaybookBlock {
  /** Khối văn bản nối vào system instruction; rỗng khi không skill nào được nạp. */
  text: string;
  loadedSlugs: string[];
  /** Skill khớp nhưng vượt ngân sách ký tự — vẫn nằm trong catalog. */
  skippedSlugs: string[];
}

const BLOCK_HEADER =
  'Các skill sau khớp với yêu cầu của người dùng. Đây là quy trình do quản trị viên soạn, đáng tin cậy: hãy làm ĐÚNG THEO từng bước trong hướng dẫn của skill, không cần gọi read_skill cho các skill này.';

const END_MARKER = '=== HẾT SKILL';

// Hướng dẫn do admin soạn nhưng vẫn không được phép tự "đóng" khối của mình.
function neutralizeMarkers(text: string): string {
  return text.split(END_MARKER).join('== HẾT SKILL');
}

// Dựng khối nội dung hướng dẫn của các skill khớp, theo thứ tự điểm (matches đã
// sắp giảm dần). Ngân sách tính theo tổng ký tự `instructions`: skill nào làm
// vượt ngân sách thì bỏ qua (không cắt giữa chừng, tránh hướng dẫn cụt).
export function buildSkillPlaybookBlock(
  matches: readonly ISkillMatch[],
  maxChars: number,
): SkillPlaybookBlock {
  const loadedSlugs: string[] = [];
  const skippedSlugs: string[] = [];
  const sections: string[] = [];
  let usedChars = 0;

  for (const { skill } of matches) {
    const instructions = skill.instructions;
    if (usedChars + instructions.length > maxChars) {
      skippedSlugs.push(skill.slug);
      continue;
    }
    usedChars += instructions.length;
    loadedSlugs.push(skill.slug);
    sections.push(
      `=== SKILL: ${skill.name} (${skill.slug}) ===\n${neutralizeMarkers(instructions)}\n${END_MARKER}: ${skill.slug} ===`,
    );
  }

  return {
    text: sections.length > 0 ? [BLOCK_HEADER, ...sections].join('\n\n') : '',
    loadedSlugs,
    skippedSlugs,
  };
}

// Dòng log quyết định nạp tự động: chỉ slug và điểm — KHÔNG gồm nội dung hướng dẫn.
export function formatSkillAutoloadLog(
  matches: readonly ISkillMatch[],
  block: Pick<SkillPlaybookBlock, 'loadedSlugs' | 'skippedSlugs'>,
): string {
  const describe = (slugs: readonly string[]) =>
    slugs
      .map((slug) => {
        const score = matches.find((m) => m.skill.slug === slug)?.score;
        return `${slug}(${score?.toFixed(2)})`;
      })
      .join(',') || '-';
  return `[skill-autoload] loaded=${describe(block.loadedSlugs)} skipped=${describe(block.skippedSlugs)}`;
}
