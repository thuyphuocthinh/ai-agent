import { ImagePromptEnrichOptions } from '../../contracts';

export class ImagePromptEnricherUtil {
  public static readonly DEFAULT_MAX_CHARS = 25_000;
  public static readonly TAG_DOC_START = '[DOCUMENT_ATTACHMENT_CONTENT]';
  public static readonly TAG_DOC_END = '[/DOCUMENT_ATTACHMENT_CONTENT]';
  public static readonly TAG_NOTE_START = '[DOCUMENT_ATTACHMENT_NOTE]';
  public static readonly TAG_NOTE_END = '[/DOCUMENT_ATTACHMENT_NOTE]';
  public static readonly TAG_USER_INSTRUCTION = '[USER_INSTRUCTION]';

  /**
   * Ghép nội dung OCR và prompt người dùng thành một context an toàn.
   */
  public static enrich(options: ImagePromptEnrichOptions): string {
    const prompt = options.userPrompt.trim();
    const { ocrResult } = options;

    if (!ocrResult || (!ocrResult.markdown?.trim() && !ocrResult.hasText)) {
      return prompt;
    }

    if (!ocrResult.hasText) {
      const summary = ocrResult.markdown?.trim() || 'Không có chữ hoặc ký tự đọc được';
      return [
        ImagePromptEnricherUtil.TAG_NOTE_START,
        `Ảnh đính kèm không chứa văn bản hoặc chữ quá mờ. Mô tả thị giác: ${summary}`,
        ImagePromptEnricherUtil.TAG_NOTE_END,
        '',
        ImagePromptEnricherUtil.TAG_USER_INSTRUCTION,
        prompt,
      ].join('\n');
    }

    const maxChars = options.maxOcrCharacters ?? ImagePromptEnricherUtil.DEFAULT_MAX_CHARS;
    let content = ocrResult.markdown.trim();

    // Chống Delimiter Injection: Khử thẻ đóng độc hại
    content = content.replaceAll(
      ImagePromptEnricherUtil.TAG_DOC_END,
      '[/DOCUMENT_ATTACHMENT_CONTENT_ESCAPED]',
    );

    if (content.length > maxChars) {
      content = `${content.slice(0, maxChars)}\n\n[...Nội dung tài liệu đã được cắt bớt do vượt quá giới hạn...]`;
    }

    const docType = ocrResult.detectedDocumentType ?? 'general_text';

    return [
      ImagePromptEnricherUtil.TAG_DOC_START,
      `Loại tài liệu nhận diện: ${docType}`,
      content,
      ImagePromptEnricherUtil.TAG_DOC_END,
      '',
      ImagePromptEnricherUtil.TAG_USER_INSTRUCTION,
      prompt,
    ].join('\n');
  }
}
