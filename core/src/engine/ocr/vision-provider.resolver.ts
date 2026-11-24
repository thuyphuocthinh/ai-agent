import { Injectable, Logger } from '@nestjs/common';
import { ELlmProvider } from '@agent/core/constants';
import {
  ResolvedVisionProviders,
} from '../../contracts';
import { OcrException } from '../../common/errors';
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
   * Phân giải Provider chính (primary) và Provider dự phòng (fallback).
   * Thứ tự mặc định: Gemini -> OpenAI (hoặc OpenAI -> Gemini nếu OCR_VISION_PROVIDER=openai).
   */
  resolve(): ResolvedVisionProviders {
    const preference = process.env.OCR_VISION_PROVIDER?.trim().toLowerCase();

    const [primaryCandidate, fallbackCandidate] =
      preference === ELlmProvider.OPENAI
        ? [this.openaiProvider, this.geminiProvider]
        : [this.geminiProvider, this.openaiProvider];

    if (primaryCandidate.isAvailable()) {
      return {
        primary: primaryCandidate,
        fallback: fallbackCandidate.isAvailable() ? fallbackCandidate : undefined,
      };
    }

    if (fallbackCandidate.isAvailable()) {
      return {
        primary: fallbackCandidate,
      };
    }

    this.logger.error('Không tìm thấy Vision LLM Provider nào khả dụng (thiếu API Key)!');
    throw new OcrException(
      'Không tìm thấy Vision LLM Provider nào được cấu hình API Key khả dụng',
      {
        code: 'OCR_PROVIDER_NOT_CONFIGURED',
        statusCode: 503,
        userFriendlyMessage:
          'Dịch vụ nhận diện tài liệu ảnh hiện chưa được cấu hình nhà cung cấp AI khả dụng.',
      },
    );
  }
}
