import { Injectable, Logger, Optional, Inject } from '@nestjs/common';
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
  IVisionLlmProvider,
} from '../../contracts';
import { OcrException } from '../../common/errors';
import { readUrlSafely } from '../../infrastructure/tools/openapi/ssrf-safe-http-reader.util';
import { ImagePreprocessorUtil } from '../../common/image/image-preprocessor.util';
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
   * Quy trình:
   * 1. Kiểm tra đầu vào, ném OcrException (400) nếu thiếu cả imageUrl lẫn imageBase64.
   * 2. Lấy Primary Provider và Fallback Provider từ Resolver.
   * 3. Đọc dữ liệu ảnh và tiền xử lý downscale/nén qua sharp.
   * 4. Gọi Primary Provider; nếu gặp lỗi sẽ tự động failover sang Fallback Provider.
   * 5. Phân tích kết quả thô thành OcrResult chuẩn hóa.
   */
  async extractText(options: OcrExtractionOptions): Promise<OcrResult> {
    if (!options.imageUrl && !options.imageBase64) {
      throw new OcrException('Phải cung cấp imageUrl hoặc imageBase64 để thực hiện OCR', {
        code: 'MISSING_IMAGE_INPUT',
        statusCode: 400,
        userFriendlyMessage: 'Yêu cầu tải lên hình ảnh hợp lệ để trích xuất văn bản.',
      });
    }

    const { primary, fallback } = this.providerResolver.resolve();
    const rawImage = await this.resolveImage(options);
    const preprocessed = await ImagePreprocessorUtil.preprocess(rawImage.base64Data);

    const rawText = await this.executeWithFallback(primary, fallback, {
      mimeType: preprocessed.mimeType,
      base64Data: preprocessed.base64Data,
    });

    return this.parseOcrResponse(rawText);
  }

  private async executeWithFallback(
    primary: IVisionLlmProvider,
    fallback: IVisionLlmProvider | undefined,
    image: { mimeType: string; base64Data: string },
  ): Promise<string> {
    const input = {
      mimeType: image.mimeType,
      base64Data: image.base64Data,
      systemPrompt: VISION_OCR_SYSTEM_PROMPT,
      userInstruction: VISION_OCR_USER_INSTRUCTION,
    };

    try {
      return await primary.generateText(input);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);

      if (!fallback) {
        throw new OcrException(`Nhà cung cấp Vision [${primary.id}] gặp sự cố: ${message}`, {
          code: 'OCR_PROVIDER_FAILED',
          statusCode: 502,
          details: { provider: primary.id, originalError: message },
          userFriendlyMessage: 'Không thể đọc được nội dung từ ảnh do nhà cung cấp AI gặp sự cố.',
        });
      }

      this.logger.warn(
        `Provider chính [${primary.id}] gặp lỗi (${message}). Đang tự động chuyển sang [${fallback.id}]...`,
      );

      try {
        return await fallback.generateText(input);
      } catch (fallbackError: unknown) {
        const fallbackMsg =
          fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
        throw new OcrException(
          `Cả hai nhà cung cấp Vision [${primary.id}] và [${fallback.id}] đều thất bại: ${fallbackMsg}`,
          {
            code: 'OCR_ALL_PROVIDERS_FAILED',
            statusCode: 502,
            details: { primary: primary.id, fallback: fallback.id, originalError: fallbackMsg },
            userFriendlyMessage:
              'Không thể xử lý ảnh do toàn bộ các dịch vụ nhận diện tài liệu đều quá tải.',
          },
        );
      }
    }
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
      return { mimeType: match[1], base64Data: raw };
    }

    return { mimeType: 'image/jpeg', base64Data: raw };
  }
}
