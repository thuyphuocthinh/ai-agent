import { ELlmProvider } from '@agent/core/constants';
import { OcrException } from '../../common/errors';
import { VisionProviderResolver } from './vision-provider.resolver';
import { GeminiVisionProvider } from './providers/gemini-vision.provider';
import { OpenAiVisionProvider } from './providers/openai-vision.provider';

describe('VisionProviderResolver', () => {
  let resolver: VisionProviderResolver;
  let mockGemini: jest.Mocked<GeminiVisionProvider>;
  let mockOpenAi: jest.Mocked<OpenAiVisionProvider>;
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.OCR_VISION_PROVIDER;

    mockGemini = {
      id: ELlmProvider.GEMINI,
      isAvailable: jest.fn(),
      generateText: jest.fn(),
    } as unknown as jest.Mocked<GeminiVisionProvider>;

    mockOpenAi = {
      id: ELlmProvider.OPENAI,
      isAvailable: jest.fn(),
      generateText: jest.fn(),
    } as unknown as jest.Mocked<OpenAiVisionProvider>;

    resolver = new VisionProviderResolver(mockGemini, mockOpenAi);
  });

  afterEach(() => {
    process.env = originalEnv;
    jest.restoreAllMocks();
  });

  describe('Auto-detection (Mặc định: Gemini -> OpenAI)', () => {
    it('ưu tiên Gemini làm primary và OpenAI làm fallback khi cả hai có sẵn', () => {
      mockGemini.isAvailable.mockReturnValue(true);
      mockOpenAi.isAvailable.mockReturnValue(true);

      const resolved = resolver.resolve();
      expect(resolved.primary).toBe(mockGemini);
      expect(resolved.fallback).toBe(mockOpenAi);
    });

    it('chuyển OpenAI làm primary khi Gemini không có sẵn', () => {
      mockGemini.isAvailable.mockReturnValue(false);
      mockOpenAi.isAvailable.mockReturnValue(true);

      const resolved = resolver.resolve();
      expect(resolved.primary).toBe(mockOpenAi);
      expect(resolved.fallback).toBeUndefined();
    });

    it('ném OcrException (503) khi cả hai provider đều không có sẵn', () => {
      mockGemini.isAvailable.mockReturnValue(false);
      mockOpenAi.isAvailable.mockReturnValue(false);

      expect(() => resolver.resolve()).toThrow(OcrException);
    });
  });

  describe('Explicit Override (OCR_VISION_PROVIDER=openai)', () => {
    it('đặt OpenAI làm primary và Gemini làm fallback khi cấu hình ưu tiên openai', () => {
      process.env.OCR_VISION_PROVIDER = ELlmProvider.OPENAI;
      mockGemini.isAvailable.mockReturnValue(true);
      mockOpenAi.isAvailable.mockReturnValue(true);

      const resolved = resolver.resolve();
      expect(resolved.primary).toBe(mockOpenAi);
      expect(resolved.fallback).toBe(mockGemini);
    });
  });
});
