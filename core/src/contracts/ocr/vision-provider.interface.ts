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
