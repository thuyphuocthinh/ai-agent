import { Injectable, Logger } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import { ORCHESTRATION_ERROR } from '@agent/core/constants';
import { IVisionLlmProvider } from '../../contracts';
import { GeminiVisionProvider } from './providers/gemini-vision.provider';
import { OpenAiVisionProvider } from './providers/openai-vision.provider';

@Injectable()
export class VisionProviderResolver {
  private readonly logger = new Logger(VisionProviderResolver.name);

  constructor(
    private readonly geminiProvider: GeminiVisionProvider,
    private readonly openaiProvider: OpenAiVisionProvider,
  ) {}

  /**
   * Tự động giải quyết provider khả dụng theo thứ tự ưu tiên:
   * 1. Cấu hình ép buộc qua biến môi trường OCR_VISION_PROVIDER ('gemini' | 'openai').
   * 2. Ưu tiên Gemini nếu có GEMINI_API_KEY.
   * 3. Fallback sang OpenAI nếu có OPENAI_API_KEY.
   */
  resolve(): IVisionLlmProvider {
    const preferred = process.env.OCR_VISION_PROVIDER?.toLowerCase();

    if (preferred === 'gemini') {
      if (this.geminiProvider.isAvailable()) return this.geminiProvider;
      throw new RpcException(ORCHESTRATION_ERROR.LLM_PROVIDER_NOT_CONFIGURED);
    }

    if (preferred === 'openai') {
      if (this.openaiProvider.isAvailable()) return this.openaiProvider;
      throw new RpcException(ORCHESTRATION_ERROR.LLM_PROVIDER_NOT_CONFIGURED);
    }

    // Auto-detection fallback
    if (this.geminiProvider.isAvailable()) {
      return this.geminiProvider;
    }

    if (this.openaiProvider.isAvailable()) {
      return this.openaiProvider;
    }

    this.logger.error('Không tìm thấy bất kỳ Vision LLM Provider nào được cấu hình API Key!');
    throw new RpcException(ORCHESTRATION_ERROR.LLM_PROVIDER_NOT_CONFIGURED);
  }
}
