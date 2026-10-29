import { ISkillPlaybookDetail } from './skill-catalog-reader.interface';

export const SKILL_MATCHER = Symbol.for('SKILL_MATCHER');

export interface ISkillMatch {
  skill: ISkillPlaybookDetail;
  /** Cosine similarity giữa prompt và mô tả skill, trong khoảng [-1, 1]. */
  score: number;
}

export interface ISkillMatcher {
  /**
   * Tìm các skill đang bật (của tenant + skill dùng chung) khớp với prompt đủ
   * ngưỡng, sắp theo điểm giảm dần, tối đa số skill cấu hình. Trả mảng rỗng
   * khi không skill nào khớp hoặc nạp tự động đang tắt.
   *
   * Có thể reject (lỗi/timeout embedding): người gọi PHẢI bắt và rơi về catalog.
   */
  match(prompt: string, tenantId?: string): Promise<ISkillMatch[]>;
}
