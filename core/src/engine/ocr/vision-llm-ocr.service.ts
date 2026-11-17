import { Injectable, Logger, Optional, Inject } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import {
  VISION_OCR_SYSTEM_PROMPT,
  VISION_OCR_USER_INSTRUCTION,
} from '@agent/core/constants';
import {
  IImageOcrService,
  OcrExtractionOptions,
  OcrResult,
  IStorageService,
  STORAGE_SERVICE,
} from '../../contracts';
import { readUrlSafely } from '../../infrastructure/tools/openapi/ssrf-safe-http-reader.util';
import { VisionProviderResolver } from './vision-provider.resolver';

@Injectable()
export class VisionLlmOcrService implements IImageOcrService {
  private readonly logger = new Logger(VisionLlmOcrService.name);

  constructor(
    private readonly providerResolver: VisionProviderResolver,
    @Optional()
    @Inject(STORAGE_SERVICE)
    private readonly storageService?: IStorageService,
  ) {}

  /**
   * Bóc tách văn bản và bảng biểu từ ảnh thành Structured Markdown.
   */
  async extractText(options: OcrExtractionOptions): Promise<OcrResult> {
    if (!options.imageUrl && !options.imageBase64) {
      throw new RpcException({
        status: 400,
        message: 'Phải cung cấp imageUrl hoặc imageBase64 để thực hiện OCR',
        code: 'MISSING_IMAGE_INPUT',
      });
    }

    // 1. Lấy Provider chiến lược phù hợp qua Resolver
    const provider = this.providerResolver.resolve();

    // 2. Phân giải dữ liệu ảnh an toàn (SSRF safe)
    const { mimeType, base64Data } = await this.resolveImage(options);

    // 3. Ủy quyền cho Provider thực thi OCR
    const rawText = await provider.generateText({
      mimeType,
      base64Data,
      systemPrompt: VISION_OCR_SYSTEM_PROMPT,
      userInstruction: VISION_OCR_USER_INSTRUCTION,
    });

    // 4. Phân tích cấu trúc phản hồi
    return this.parseOcrResponse(rawText);
  }

  private parseOcrResponse(rawText: string): OcrResult {
    const isNoText = rawText.includes('[NO_TEXT_DETECTED]');

    if (isNoText) {
      return {
        markdown: rawText.replace('[NO_TEXT_DETECTED]:', '').trim(),
        hasText: false,
        detectedDocumentType: 'non_text',
        characterCount: 0,
      };
    }

    const hasTable = rawText.includes('|') && rawText.includes('---');
    return {
      markdown: rawText,
      hasText: true,
      detectedDocumentType: hasTable ? 'table' : 'general_text',
      characterCount: rawText.length,
    };
  }

  private async resolveImage(
    options: OcrExtractionOptions,
  ): Promise<{ mimeType: string; base64Data: string }> {
    if (options.imageUrl) {
      const localMatch = options.imageUrl.match(/\/api\/storage\/local\/(.+)$/);
      if (localMatch && this.storageService) {
        try {
          const file = await this.storageService.getFile(localMatch[1]);
          return {
            mimeType: file.contentType,
            base64Data: file.buffer.toString('base64'),
          };
        } catch {
          // Bỏ qua lỗi fallback sang readUrlSafely
        }
      }

      const buffer = await readUrlSafely(options.imageUrl);
      return {
        mimeType: 'image/jpeg',
        base64Data: buffer.toString('base64'),
      };
    }

    const raw = options.imageBase64!;
    const match = raw.match(/^data:([a-zA-Z0-9]+\/[a-zA-Z0-9-.+]+);base64,(.+)$/);
    if (match) {
      return { mimeType: match[1], base64Data: match[2] };
    }

    return { mimeType: 'image/jpeg', base64Data: raw };
  }
}
