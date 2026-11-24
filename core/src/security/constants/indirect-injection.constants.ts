export const INDIRECT_INJECTION_GUARD = Symbol('INDIRECT_INJECTION_GUARD');

export enum EInjectionThreatLevel {
  SAFE = 'SAFE',
  SUSPICIOUS = 'SUSPICIOUS',
  BLOCKED = 'BLOCKED',
}

export enum EInjectionCategory {
  DIRECTIVE_OVERRIDE = 'DIRECTIVE_OVERRIDE',
  JAILBREAK_PERSONA = 'JAILBREAK_PERSONA',
  DATA_EXFILTRATION = 'DATA_EXFILTRATION',
  DELIMITER_SPOOFING = 'DELIMITER_SPOOFING',
}

/**
 * Mã định danh quy chế an ninh rõ nghĩa (Semantic Domain-Driven),
 * không dùng số đuôi khó hiểu (_001, _002) để người đọc và log kiểm toán hiểu ngay nghiệp vụ.
 */
export enum ESecurityPolicyRule {
  INDIRECT_PROMPT_INJECTION = 'RULE_INDIRECT_PROMPT_INJECTION',
  DIRECT_PROMPT_INJECTION = 'RULE_DIRECT_PROMPT_INJECTION',
  DELIMITER_SPOOFING_ATTEMPT = 'RULE_DELIMITER_SPOOFING_ATTEMPT',
}

export interface IInjectionPatternRule {
  readonly category: EInjectionCategory;
  readonly pattern: RegExp;
  readonly isCritical: boolean;
}

export const INJECTION_DETECTION_RULES: readonly IInjectionPatternRule[] = [
  // 1. Chỉ thị ghi đè hệ thống (Directive Override - English)
  {
    category: EInjectionCategory.DIRECTIVE_OVERRIDE,
    pattern:
      /(?:ignore|disregard|forget|override)\s+(?:all\s+)?(?:previous|prior|above|system)\s+(?:instructions|directives|prompts|rules)/i,
    isCritical: true,
  },
  // 1b. Chỉ thị ghi đè hệ thống (Directive Override - Tiếng Việt)
  {
    category: EInjectionCategory.DIRECTIVE_OVERRIDE,
    pattern:
      /(?:bỏ qua|quên|ghi đè)\s+(?:tất cả\s+)?(?:hướng dẫn|chỉ thị|quy tắc|lệnh)\s+(?:trước|cũ|hệ thống)/i,
    isCritical: true,
  },

  // 2. Chiếm quyền nhân vật / Jailbreak (Persona Hijack - English)
  {
    category: EInjectionCategory.JAILBREAK_PERSONA,
    pattern:
      /(?:you are now|act as|pretend to be|switch to)\s+(?:in\s+)?(?:developer\s+mode|dan|jailbreak|unrestricted|god\s+mode|root)/i,
    isCritical: true,
  },
  // 2b. Chiếm quyền nhân vật / Jailbreak (Persona Hijack - Tiếng Việt)
  {
    category: EInjectionCategory.JAILBREAK_PERSONA,
    pattern:
      /(?:bây giờ bạn là|đóng vai|chuyển sang)\s+(?:developer\s+mode|dan|không giới hạn|chế độ nhà phát triển)/i,
    isCritical: true,
  },

  // 3. Khai thác & Đánh cắp dữ liệu bí mật (Data Exfiltration - Song ngữ)
  {
    category: EInjectionCategory.DATA_EXFILTRATION,
    pattern:
      /(?:reveal|output|display|show|in ra|tiết lộ)\s+(?:system\s*prompt|api\s*key|credentials|secret|mật khẩu|khóa bí mật)/i,
    isCritical: true,
  },

  // 4. Giả mạo thẻ đóng cấu trúc (Delimiter Spoofing)
  {
    category: EInjectionCategory.DELIMITER_SPOOFING,
    pattern:
      /(?:&lt;\/untrusted_tool_data&gt;|<\/untrusted_tool_data>|<system>|\[SYSTEM\]|<\|im_start\|>system)/i,
    isCritical: false,
  },
];
