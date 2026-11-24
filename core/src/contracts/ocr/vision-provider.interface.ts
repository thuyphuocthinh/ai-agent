export interface IVisionLlmInput {
  mimeType: string;
  base64Data: string;
  systemPrompt: string;
  userInstruction: string;
}

export interface IVisionLlmProvider {
  /** Mã định danh provider: 'gemini' | 'openai' | ... */
  readonly id: string;

  /** Kiểm tra xem provider có sẵn sàng không (đã có API key hợp lệ trong env) */
  isAvailable(): boolean;

  /** Gọi LLM Vision để bóc tách văn bản thô */
  generateText(input: IVisionLlmInput): Promise<string>;
}

/**
 * Cặp Provider được phân giải cho cơ chế Fallback tường minh:
 * Primary: Provider chính được ưu tiên chạy trước.
 * Fallback: Provider dự phòng nếu Primary gặp lỗi quá tải (429) hoặc sự cố hạ tầng (5xx).
 */
export interface ResolvedVisionProviders {
  primary: IVisionLlmProvider;
  fallback?: IVisionLlmProvider;
}
