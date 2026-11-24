import { ImagePromptEnrichOptions, OcrResult } from '../../contracts';

export class ImagePromptEnricherUtil {
  public static readonly DEFAULT_MAX_CHARS = 25_000;
  public static readonly TAG_DOC_START = '[DOCUMENT_ATTACHMENT_CONTENT]';
  public static readonly TAG_DOC_END = '[/DOCUMENT_ATTACHMENT_CONTENT]';
  public static readonly TAG_DOC_END_ESCAPED = '[/DOCUMENT_ATTACHMENT_CONTENT_ESCAPED]';
  public static readonly TAG_NOTE_START = '[DOCUMENT_ATTACHMENT_NOTE]';
  public static readonly TAG_NOTE_END = '[/DOCUMENT_ATTACHMENT_NOTE]';
  public static readonly TAG_USER_INSTRUCTION = '[USER_INSTRUCTION]';

  /**
   * Ghép nội dung OCR từ một hoặc nhiều ảnh vào prompt của người dùng.
   */
  public static enrich(options: ImagePromptEnrichOptions): string {
    const userPrompt = options.userPrompt.trim();
    const ocrResults = this.extractOcrResults(options);

    if (ocrResults.length === 0) {
      return userPrompt;
    }

    const hasAnyReadableText = ocrResults.some((result) => result.hasText);
    if (!hasAnyReadableText) {
      return this.buildNonTextPrompt(ocrResults, userPrompt);
    }

    return this.buildEnrichedPrompt(ocrResults, userPrompt, options.maxOcrCharacters);
  }

  /**
   * Trích xuất và chuẩn hóa danh sách OcrResult từ ImagePromptEnrichOptions.
   */
  private static extractOcrResults(options: ImagePromptEnrichOptions): OcrResult[] {
    const list = options.ocrResults ?? (options.ocrResult ? [options.ocrResult] : []);
    return list.filter((item) => item.hasText || item.markdown?.trim());
  }

  /**
   * Tạo prompt cảnh báo khi toàn bộ ảnh đính kèm không chứa văn bản đọc được.
   */
  private static buildNonTextPrompt(ocrResults: OcrResult[], userPrompt: string): string {
    const visualNotes = ocrResults
      .map((result, index) => {
        const prefix = ocrResults.length > 1 ? `[Ảnh ${index + 1}]: ` : '';
        const description = result.markdown?.trim() || 'Không có chữ hoặc ký tự đọc được';
        return `${prefix}${description}`;
      })
      .join('; ');

    return [
      this.TAG_NOTE_START,
      `Ảnh đính kèm không chứa văn bản hoặc chữ quá mờ. Mô tả thị giác: ${visualNotes}`,
      this.TAG_NOTE_END,
      '',
      this.TAG_USER_INSTRUCTION,
      userPrompt,
    ].join('\n');
  }

  /**
   * Ghép nối các đoạn Markdown từ từng ảnh, khử Delimiter Injection và cắt tỉa theo ngưỡng ký tự.
   */
  private static buildEnrichedPrompt(
    ocrResults: OcrResult[],
    userPrompt: string,
    maxCharacters?: number,
  ): string {
    const maxChars = maxCharacters ?? this.DEFAULT_MAX_CHARS;
    const documentSections = ocrResults.map((ocrResult, index) =>
      this.formatImageDocumentMarkdown(ocrResult, index + 1, ocrResults.length),
    );

    let combinedMarkdown = documentSections.join('\n\n---\n\n');
    combinedMarkdown = this.sanitizeDelimiterTags(combinedMarkdown);
    combinedMarkdown = this.truncateContent(combinedMarkdown, maxChars);

    return [
      this.TAG_DOC_START,
      combinedMarkdown,
      this.TAG_DOC_END,
      '',
      this.TAG_USER_INSTRUCTION,
      userPrompt,
    ].join('\n');
  }

  /**
   * Định dạng nội dung OCR của một hình ảnh cụ thể thành khối Markdown có đánh số thứ tự.
   */
  private static formatImageDocumentMarkdown(
    ocrResult: OcrResult,
    imageIndex: number,
    totalImages: number,
  ): string {
    const indexLabel = totalImages > 1 ? `### [Tài liệu ảnh ${imageIndex}/${totalImages}]\n` : '';
    const docTypeLabel = `Loại tài liệu nhận diện: ${ocrResult.detectedDocumentType ?? 'general_text'}`;
    const textContent = ocrResult.hasText
      ? ocrResult.markdown.trim()
      : `(Ảnh không có văn bản: ${ocrResult.markdown?.trim() || 'Chữ mờ/không nhận diện được'})`;

    return `${indexLabel}${docTypeLabel}\n\n${textContent}`;
  }

  private static sanitizeDelimiterTags(content: string): string {
    return content.replaceAll(this.TAG_DOC_END, this.TAG_DOC_END_ESCAPED);
  }

  private static truncateContent(content: string, maxChars: number): string {
    if (content.length <= maxChars) {
      return content;
    }
    return `${content.slice(0, maxChars)}\n\n[...Nội dung tài liệu đã được cắt bớt do vượt quá giới hạn...]`;
  }
}
