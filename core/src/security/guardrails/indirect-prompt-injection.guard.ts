import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import {
  EInjectionThreatLevel,
  type IIndirectPromptInjectionGuard,
  type IInjectionEvaluationResult,
  type IInjectionSignatureMatch,
} from '../contracts/indirect-injection.interface';
import { INJECTION_DETECTION_RULES } from '../constants/indirect-injection.constants';
import { UntrustedContentSanitizerUtil } from './untrusted-content-sanitizer.util';

@Injectable()
export class IndirectPromptInjectionGuard
  implements IIndirectPromptInjectionGuard
{
  private readonly logger = new Logger(IndirectPromptInjectionGuard.name);

  public evaluateToolOutput(
    rawToolOutput: unknown,
    toolName: string,
  ): IInjectionEvaluationResult {
    const rawString =
      typeof rawToolOutput === 'string'
        ? rawToolOutput
        : JSON.stringify(rawToolOutput ?? '');

    // 1. Khử trùng ký tự tàng hình và escape thẻ phân cách
    const { sanitizedText } =
      UntrustedContentSanitizerUtil.sanitizeText(rawString);

    // 2. Quét signature phát hiện mẫu tấn công
    const matches: IInjectionSignatureMatch[] = [];
    let hasCriticalMatch = false;

    for (const rule of INJECTION_DETECTION_RULES) {
      const match = sanitizedText.match(rule.pattern);
      if (match) {
        matches.push({
          category: rule.category,
          matchedText: match[0],
        });
        if (rule.isCritical) {
          hasCriticalMatch = true;
        }
      }
    }

    // 3. Phân định Threat Level:
    // - BLOCKED: Khi có từ 2 vi phạm trở lên HOẶC 1 vi phạm đặc biệt nghiêm trọng (Critical)
    // - SUSPICIOUS: Khi có 1 vi phạm không thuộc loại critical
    // - SAFE: Không phát hiện bất kỳ mẫu nào
    let threatLevel = EInjectionThreatLevel.SAFE;
    if (matches.length >= 2 || hasCriticalMatch) {
      threatLevel = EInjectionThreatLevel.BLOCKED;
    } else if (matches.length === 1) {
      threatLevel = EInjectionThreatLevel.SUSPICIOUS;
    }

    const contentHash = createHash('sha256')
      .update(sanitizedText, 'utf8')
      .digest('hex');

    // 4. Xử lý an toàn khi bị BLOCKED
    if (threatLevel === EInjectionThreatLevel.BLOCKED) {
      this.logger.warn(
        `[SECURITY CRITICAL] Chặn Indirect Prompt Injection từ tool=${toolName}! Detected: ${matches.map((m) => m.matchedText).join(', ')}`,
      );

      const blockedBody = `[SECURITY_BLOCKED]: Dữ liệu trả về từ công cụ "${toolName}" đã bị vô hiệu hóa vì chứa chỉ thị tấn công chiếm quyền (Indirect Prompt Injection).`;
      const wrappedXml = UntrustedContentSanitizerUtil.encapsulateXml(
        toolName,
        threatLevel,
        contentHash,
        blockedBody,
      );

      return {
        threatLevel,
        matches,
        contentHash,
        wrappedXml,
      };
    }

    // 5. Đóng gói XML an toàn cho các trường hợp SAFE hoặc SUSPICIOUS
    const wrappedXml = UntrustedContentSanitizerUtil.encapsulateXml(
      toolName,
      threatLevel,
      contentHash,
      sanitizedText,
    );

    return {
      threatLevel,
      matches,
      contentHash,
      wrappedXml,
    };
  }
}
