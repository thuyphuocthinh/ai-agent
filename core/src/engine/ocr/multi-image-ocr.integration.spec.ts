import sharp = require('sharp');
import { VisionLlmOcrService } from './vision-llm-ocr.service';
import { VisionProviderResolver } from './vision-provider.resolver';
import { GeminiVisionProvider } from './providers/gemini-vision.provider';
import { OpenAiVisionProvider } from './providers/openai-vision.provider';
import { ImagePromptEnricherUtil } from '../../common/text/image-prompt-enricher.util';
import { OcrException } from '../../common/errors';
import { ELlmProvider } from '../../constants';
import { IVisionLlmInput } from '../../contracts';

describe('Multi-Image OCR & Runtime Provider Fallback (Integration)', () => {
  let geminiProvider: jest.Mocked<GeminiVisionProvider>;
  let openaiProvider: jest.Mocked<OpenAiVisionProvider>;
  let resolver: VisionProviderResolver;
  let ocrService: VisionLlmOcrService;

  beforeEach(() => {
    delete process.env.OCR_VISION_PROVIDER;

    geminiProvider = {
      id: ELlmProvider.GEMINI,
      isAvailable: jest.fn().mockReturnValue(true),
      generateText: jest.fn(),
    } as unknown as jest.Mocked<GeminiVisionProvider>;

    openaiProvider = {
      id: ELlmProvider.OPENAI,
      isAvailable: jest.fn().mockReturnValue(true),
      generateText: jest.fn(),
    } as unknown as jest.Mocked<OpenAiVisionProvider>;

    resolver = new VisionProviderResolver(geminiProvider, openaiProvider);
    ocrService = new VisionLlmOcrService(resolver);
  });

  describe('[AC-11] Image Preprocessing & Downscaling Integration', () => {
    it('tự động giảm kích thước ảnh > 1920px và nén JPEG trước khi gửi Vision Provider', async () => {
      // Tạo ảnh thử nghiệm kích thước lớn 2400x1200
      const largeBuffer = await sharp({
        create: {
          width: 2400,
          height: 1200,
          channels: 3,
          background: { r: 100, g: 150, b: 200 },
        },
      })
        .png()
        .toBuffer();

      geminiProvider.generateText.mockResolvedValueOnce(
        '| STT | Tên hàng |\n|---|---|\n| 1 | Màn hình 4K |',
      );

      const result = await ocrService.extractText({
        imageBase64: `data:image/png;base64,${largeBuffer.toString('base64')}`,
      });

      expect(geminiProvider.generateText).toHaveBeenCalledTimes(1);
      const callArg = geminiProvider.generateText.mock.calls[0][0] as IVisionLlmInput;

      expect(callArg.mimeType).toBe('image/jpeg');

      // Giải mã dữ liệu gửi sang LLM để kiểm tra kích thước thực tế
      const processedMeta = await sharp(Buffer.from(callArg.base64Data, 'base64')).metadata();
      expect(processedMeta.width).toBe(1920);
      expect(processedMeta.height).toBe(960);
      expect(result.detectedDocumentType).toBe('table');
      expect(result.markdown).toContain('| STT | Tên hàng |');
    });
  });

  describe('[AC-12] Multi-Image Batch Ingestion & Formatting Integration', () => {
    it('bóc tách song song nhiều ảnh và định dạng Markdown phân chia theo chỉ số', async () => {
      const img1 = await sharp({
        create: { width: 400, height: 300, channels: 3, background: { r: 255, g: 0, b: 0 } },
      })
        .jpeg()
        .toBuffer();

      const img2 = await sharp({
        create: { width: 500, height: 400, channels: 3, background: { r: 0, g: 255, b: 0 } },
      })
        .jpeg()
        .toBuffer();

      geminiProvider.generateText.mockImplementation(async (input) => {
        const meta = await sharp(Buffer.from(input.base64Data, 'base64')).metadata();
        return meta.width === 400
          ? 'Trang 1: Hóa đơn điện tử số 001'
          : 'Trang 2: Biên bản bàn giao thiết bị';
      });

      const images = [
        `data:image/jpeg;base64,${img1.toString('base64')}`,
        `data:image/jpeg;base64,${img2.toString('base64')}`,
      ];

      // Giả lập bóc tách song song nhiều ảnh
      const ocrResults = await Promise.all(
        images.map((imageBase64) => ocrService.extractText({ imageBase64 })),
      );

      expect(ocrResults).toHaveLength(2);
      expect(ocrResults[0].markdown).toBe('Trang 1: Hóa đơn điện tử số 001');
      expect(ocrResults[1].markdown).toBe('Trang 2: Biên bản bàn giao thiết bị');

      const enrichedPrompt = ImagePromptEnricherUtil.enrich({
        ocrResults,
        userPrompt: 'Hãy đối chiếu 2 trang tài liệu này',
      });

      expect(enrichedPrompt).toContain('### [Tài liệu ảnh 1/2]');
      expect(enrichedPrompt).toContain('Trang 1: Hóa đơn điện tử số 001');
      expect(enrichedPrompt).toContain('### [Tài liệu ảnh 2/2]');
      expect(enrichedPrompt).toContain('Trang 2: Biên bản bàn giao thiết bị');
      expect(enrichedPrompt).toContain('Hãy đối chiếu 2 trang tài liệu này');
    });
  });

  describe('[AC-13] Runtime Provider Fallback Integration', () => {
    it('tự động failover sang OpenAI khi Gemini gặp lỗi 429 Rate Limit', async () => {
      const buffer = await sharp({
        create: { width: 200, height: 200, channels: 3, background: { r: 200, g: 200, b: 200 } },
      })
        .jpeg()
        .toBuffer();

      geminiProvider.generateText.mockRejectedValueOnce(
        new Error('429 Too Many Requests: Rate limit exceeded'),
      );
      openaiProvider.generateText.mockResolvedValueOnce(
        'Nội dung OCR trích xuất thành công từ OpenAI Fallback',
      );

      const result = await ocrService.extractText({
        imageBase64: `data:image/jpeg;base64,${buffer.toString('base64')}`,
      });

      expect(geminiProvider.generateText).toHaveBeenCalledTimes(1);
      expect(openaiProvider.generateText).toHaveBeenCalledTimes(1);
      expect(result.markdown).toBe('Nội dung OCR trích xuất thành công từ OpenAI Fallback');
      expect(result.hasText).toBe(true);
    });

    it('tự động failover sang Gemini khi OpenAI được cấu hình ưu tiên nhưng gặp lỗi 503', async () => {
      process.env.OCR_VISION_PROVIDER = ELlmProvider.OPENAI;

      const buffer = await sharp({
        create: { width: 200, height: 200, channels: 3, background: { r: 200, g: 200, b: 200 } },
      })
        .jpeg()
        .toBuffer();

      openaiProvider.generateText.mockRejectedValueOnce(new Error('503 Service Unavailable'));
      geminiProvider.generateText.mockResolvedValueOnce('Nội dung OCR từ Gemini dự phòng');

      const result = await ocrService.extractText({
        imageBase64: `data:image/jpeg;base64,${buffer.toString('base64')}`,
      });

      expect(openaiProvider.generateText).toHaveBeenCalledTimes(1);
      expect(geminiProvider.generateText).toHaveBeenCalledTimes(1);
      expect(result.markdown).toBe('Nội dung OCR từ Gemini dự phòng');
    });

    it('ném OcrException 502 khi cả hai Provider đều thất bại', async () => {
      const buffer = await sharp({
        create: { width: 200, height: 200, channels: 3, background: { r: 200, g: 200, b: 200 } },
      })
        .jpeg()
        .toBuffer();

      geminiProvider.generateText.mockRejectedValueOnce(new Error('Gemini outage'));
      openaiProvider.generateText.mockRejectedValueOnce(new Error('OpenAI outage'));

      await expect(
        ocrService.extractText({
          imageBase64: `data:image/jpeg;base64,${buffer.toString('base64')}`,
        }),
      ).rejects.toMatchObject({
        code: 'OCR_ALL_PROVIDERS_FAILED',
        statusCode: 502,
      });
    });

    it('ném OcrException 400 khi không cung cấp cả imageUrl lẫn imageBase64', async () => {
      await expect(ocrService.extractText({})).rejects.toMatchObject({
        code: 'MISSING_IMAGE_INPUT',
        statusCode: 400,
      });
    });
  });
});
