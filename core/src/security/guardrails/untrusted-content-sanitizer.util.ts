import type { IContentSanitizationResult } from '../contracts/indirect-injection.interface';

export class UntrustedContentSanitizerUtil {
  // Regex loại bỏ Zero-width space, Zero-width joiner, BiDi Unicode overrides
  private static readonly ZERO_WIDTH_REGEX =
    /[\u200B-\u200D\uFEFF\u202A-\u202E\u2060-\u206F]/g;

  /**
   * Khử trùng chuỗi: bóc tách ký tự tàng hình và escape thẻ XML phân cách
   */
  public static sanitizeText(text: string): IContentSanitizationResult {
    const withoutZeroWidth = text.replace(this.ZERO_WIDTH_REGEX, '');

    // Escape các thẻ phân cách để chống Delimiter Breakout
    const escaped = withoutZeroWidth
      .replace(/<\/untrusted_tool_data>/gi, '&lt;/untrusted_tool_data&gt;')
      .replace(/<!\[CDATA\[/gi, '&lt;![CDATA[')
      .replace(/\]\]>/gi, ']]&gt;');

    return {
      sanitizedText: escaped,
      hasModifications: escaped !== text,
    };
  }

  /**
   * Đóng gói nội dung vào thẻ XML phân định ranh giới ngữ cảnh
   */
  public static encapsulateXml(
    toolName: string,
    threatLevel: string,
    contentHash: string,
    body: string,
  ): string {
    return [
      `<untrusted_tool_data tool="${toolName}" threat_level="${threatLevel}" hash="${contentHash.slice(0, 16)}">`,
      body,
      `</untrusted_tool_data>`,
    ].join('\n');
  }
}
