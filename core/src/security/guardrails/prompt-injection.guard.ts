import { Injectable, Logger } from '@nestjs/common';
import { PromptInspectionResult } from '../security.interface';
import { PromptInjectionDetectedError } from '../errors/prompt-injection.error';
import { PiiScrubberUtil } from '../pii/pii-scrubber.util';
import { ERiskLevel } from '../constants/security.constants';

/**
 * Guardrail bảo vệ đầu vào của AI Agent Engine:
 * 1. Phát hiện sớm các câu lệnh Prompt Injection / Jailbreak / Directive Override (< 2ms).
 * 2. Tự động che giấu (masking) thông tin nhạy cảm (PII, STK ngân hàng, số thẻ, CCCD).
 */
@Injectable()
export class PromptInjectionGuard {
  private readonly logger = new Logger(PromptInjectionGuard.name);

  private readonly INJECTION_PATTERNS: RegExp[] = [
    // Directive override (English)
    /(?:ignore|disregard|forget|override)\s+(?:all\s+)?(?:previous|prior|above|system)\s+(?:instructions|directions|prompts|rules)/i,
    // Jailbreak / Persona hijack (English)
    /(?:you are now|act as|pretend to be|switch to)\s+(?:in\s+)?(?:developer\s+mode|dan|jailbreak|unrestricted|god\s+mode|root)/i,
    // Directive override (Vietnamese)
    /(?:bỏ qua|quên|ghi đè)\s+(?:tất cả\s+)?(?:hướng dẫn|chỉ thị|quy tắc|lệnh)\s+(?:trước|cũ|hệ thống)/i,
    // Jailbreak / Persona hijack (Vietnamese)
    /(?:bây giờ bạn là|đóng vai|chuyển sang)\s+(?:developer\s+mode|dan|không giới hạn|chế độ nhà phát triển)/i,
    // Delimiter & XML tag injection
    /(?:<system>|\[SYSTEM\]|```system|<\|im_start\|>system)/i,
    // Prompt leaking / Extraction attacks
    /(?:show|reveal|display|output|print|echo|repeat)\s+(?:system\s+prompt|hidden\s+instructions|internal\s+prompt|secret\s+instructions)/i,
    /(?:tiết lộ|in ra|hiển thị|đọc lại)\s+(?:system\s+prompt|chỉ thị ẩn|prompt\s+gốc|hướng dẫn ban đầu)/i,
  ];

  // Regex phát hiện số tài khoản ngân hàng / số thẻ (10-19 chữ số liên tục hoặc ngăn cách bởi space/dash)
  private readonly BANK_ACCOUNT_REGEX = /\b(\d{4})[\s-]?\d{2,11}[\s-]?(\d{4})\b/g;

  // Regex phát hiện CCCD Việt Nam (12 chữ số)
  private readonly CCCD_REGEX = /\b(\d{3})\d{6}(\d{3})\b/g;

  /**
   * Thẩm tra câu lệnh đầu vào để phát hiện nguy cơ tấn công prompt injection
   * và làm sạch dữ liệu nhạy cảm PII.
   */
  inspect(prompt: string): PromptInspectionResult {
    const trimmed = prompt.trim();

    // 1. Kiểm tra các mẫu Prompt Injection
    for (const pattern of this.INJECTION_PATTERNS) {
      const match = trimmed.match(pattern);
      if (match) {
        this.logger.warn(`Phát hiện Prompt Injection: pattern="${match[0]}"`);
        return {
          safe: false,
          riskLevel: ERiskLevel.HIGH,
          reason: 'Phát hiện chỉ thị vi phạm quy tắc an toàn (Prompt Injection)',
          matchedPattern: match[0],
          sanitizedPrompt: this.maskSensitiveData(trimmed),
        };
      }
    }

    // 2. Làm sạch PII và thông tin tài khoản ngân hàng
    const sanitizedPrompt = this.maskSensitiveData(trimmed);

    return {
      safe: true,
      riskLevel: ERiskLevel.LOW,
      sanitizedPrompt,
    };
  }

  /**
   * Xác thực và ném exception nếu phát hiện mã độc hại.
   * Trả về prompt đã được che giấu dữ liệu nhạy cảm.
   */
  assertSafe(prompt: string): string {
    const result = this.inspect(prompt);
    if (!result.safe) {
      throw new PromptInjectionDetectedError(
        result.reason || 'Prompt Injection Detected',
        result.riskLevel,
        result.matchedPattern,
      );
    }
    return result.sanitizedPrompt ?? prompt;
  }

  /**
   * Che giấu số tài khoản ngân hàng, số thẻ tín dụng, CCCD và các PII khác.
   * Ví dụ: 19036789123456 -> 1903****456
   */
  maskSensitiveData(text: string): string {
    if (!text) return text;

    let scrubbed = text;

    // 1. Che giấu số CCCD (12 số -> 3 số đầu + ****** + 3 số cuối)
    scrubbed = scrubbed.replace(this.CCCD_REGEX, (_full, prefix, suffix) => {
      return `${prefix}******${suffix}`;
    });

    // 2. Che giấu số tài khoản ngân hàng / thẻ ngân hàng (10-19 chữ số)
    scrubbed = scrubbed.replace(this.BANK_ACCOUNT_REGEX, (_full, prefix, suffix) => {
      return `${prefix}****${suffix}`;
    });

    // 3. Áp dụng PiiScrubberUtil nền tảng cho các PII khác (email, token...)
    scrubbed = PiiScrubberUtil.scrub(scrubbed) as string;

    return scrubbed;
  }
}
