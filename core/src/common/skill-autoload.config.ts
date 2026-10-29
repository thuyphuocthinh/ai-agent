import {
  parseBooleanEnv,
  parseNumberEnv,
  parsePositiveIntEnv,
} from './env.util';

export interface SkillAutoloadConfig {
  enabled: boolean;
  /** Cosine tối thiểu giữa prompt và mô tả skill để được nạp tự động. */
  minScore: number;
  maxSkills: number;
  /** Tổng ký tự `instructions` tối đa được nạp vào một system instruction. */
  maxChars: number;
  timeoutMs: number;
}

// minScore tạm thời — được chốt bằng dữ liệu thật ở bước hiệu chỉnh (script skill:eval).
export const SKILL_AUTOLOAD_DEFAULTS: SkillAutoloadConfig = {
  enabled: true,
  minScore: 0.4,
  maxSkills: 2,
  maxChars: 6000,
  timeoutMs: 1500,
};

// Đọc env tại thời điểm gọi (không cache) để đổi cấu hình và test dễ dàng;
// giá trị sai/không hợp lệ rơi về mặc định thay vì làm hỏng lượt chạy.
export function readSkillAutoloadConfig(
  env: NodeJS.ProcessEnv = process.env,
): SkillAutoloadConfig {
  const d = SKILL_AUTOLOAD_DEFAULTS;
  return {
    enabled: parseBooleanEnv(env.SKILL_AUTOLOAD_ENABLED, d.enabled),
    minScore: parseNumberEnv(
      env.SKILL_AUTOLOAD_MIN_SCORE,
      d.minScore,
      (score) => score > 0 && score <= 1,
    ),
    maxSkills: parsePositiveIntEnv(env.SKILL_AUTOLOAD_MAX_SKILLS, d.maxSkills),
    maxChars: parsePositiveIntEnv(env.SKILL_AUTOLOAD_MAX_CHARS, d.maxChars),
    timeoutMs: parsePositiveIntEnv(env.SKILL_AUTOLOAD_TIMEOUT_MS, d.timeoutMs),
  };
}
