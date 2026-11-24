/**
 * Tùy chọn đầu vào cho tác vụ OCR bóc tách văn bản từ ảnh.
 */
export interface OcrExtractionOptions {
  /**
   * Đường dẫn URL ảnh (khuyên dùng khi FE upload trực tiếp lên S3/Cloud CDN).
   */
  imageUrl?: string;

  /**
   * Chuỗi dữ liệu ảnh Base64 (data:image/...;base64,... hoặc raw base64 string).
   */
  imageBase64?: string;

  /**
   * Danh sách nhiều đường dẫn URL ảnh (tối đa 5 ảnh) để xử lý song song.
   */
  images?: string[];

  /**
   * Turn ID hiện tại để phục vụ việc lưu trữ tạm thời an toàn nếu cần offload đĩa.
   */
  turnId?: string;

  /**
   * Timeout tối đa cho tác vụ OCR (mặc định: 30000ms).
   */
  timeoutMs?: number;
}

/**
 * Cấu hình tiền xử lý ảnh trước khi gửi sang Vision LLM.
 */
export interface ImagePreprocessOptions {
  maxDimension?: number;
  quality?: number;
  sizeThresholdBytes?: number;
}

/**
 * Kết quả tiền xử lý ảnh đã được chuẩn hóa.
 */
export interface PreprocessedImageResult {
  buffer: Buffer;
  mimeType: string;
  base64Data: string;
  width?: number;
  height?: number;
  wasProcessed: boolean;
}

/**
 * Phân loại sơ bộ dạng tài liệu nhận diện được từ ảnh.
 */
export type DetectedDocumentType =
  | 'invoice'
  | 'receipt'
  | 'table'
  | 'form'
  | 'general_text'
  | 'non_text';

/**
 * Kết quả trích xuất văn bản từ ảnh được chuẩn hóa.
 */
export interface OcrResult {
  /**
   * Toàn bộ nội dung đọc được định dạng dưới dạng Structured Markdown
   * (bảo toàn bảng | ... |, tiêu đề, danh sách, và key-value).
   */
  markdown: string;

  /**
   * Cờ xác định ảnh có chứa văn bản đọc được hay không.
   * false nếu là ảnh phong cảnh, ảnh mờ, hoặc không có ký tự.
   */
  hasText: boolean;

  /**
   * Phân loại sơ bộ dạng tài liệu (nếu nhận diện được).
   */
  detectedDocumentType?: DetectedDocumentType;

  /**
   * Tổng số ký tự đã trích xuất được.
   */
  characterCount: number;

  /**
   * Metadata bổ sung (ví dụ: model thực hiện, thời gian xử lý ms).
   */
  metadata?: Record<string, unknown>;
}

/**
 * Tham số đầu vào cho tiện ích ghép nối prompt và nội dung OCR.
 * Đặt tại contracts để tuân thủ quy tắc kiến trúc phân tầng.
 */
export interface ImagePromptEnrichOptions {
  ocrResult?: OcrResult;
  ocrResults?: OcrResult[];
  userPrompt: string;
  maxOcrCharacters?: number;
}

/**
 * Interface trừu tượng cho dịch vụ OCR bóc tách ảnh thành Markdown.
 * Không phụ thuộc vào provider cụ thể (Gemini, OpenAI, PaddleOCR).
 */
export interface IImageOcrService {
  extractText(options: OcrExtractionOptions): Promise<OcrResult>;
}

/**
 * Dependency Injection Token cho IImageOcrService.
 */
export const IMAGE_OCR_SERVICE = Symbol.for('IMAGE_OCR_SERVICE');
