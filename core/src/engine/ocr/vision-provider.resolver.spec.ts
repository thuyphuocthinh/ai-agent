import { RpcException } from '@nestjs/microservices';
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
      id: 'gemini',
      isAvailable: jest.fn(),
      generateText: jest.fn(),
    } as unknown as jest.Mocked<GeminiVisionProvider>;

    mockOpenAi = {
      id: 'openai',
      isAvailable: jest.fn(),
      generateText: jest.fn(),
    } as unknown as jest.Mocked<OpenAiVisionProvider>;

    resolver = new VisionProviderResolver(mockGemini, mockOpenAi);
  });

  afterEach(() => {
    process.env = originalEnv;
    jest.restoreAllMocks();
  });

  describe('Auto-detection', () => {
    it('ưu tiên Gemini khi Gemini có sẵn', () => {
      mockGemini.isAvailable.mockReturnValue(true);
      mockOpenAi.isAvailable.mockReturnValue(true);

      const provider = resolver.resolve();
      expect(provider).toBe(mockGemini);
    });

    it('fallback sang OpenAI khi Gemini không có sẵn nhưng OpenAI có sẵn', () => {
      mockGemini.isAvailable.mockReturnValue(false);
      mockOpenAi.isAvailable.mockReturnValue(true);

      const provider = resolver.resolve();
      expect(provider).toBe(mockOpenAi);
    });

    it('ném RpcException khi cả hai provider đều không có sẵn', () => {
      mockGemini.isAvailable.mockReturnValue(false);
      mockOpenAi.isAvailable.mockReturnValue(false);

      expect(() => resolver.resolve()).toThrow(RpcException);
    });
  });

  describe('Explicit Override (OCR_VISION_PROVIDER)', () => {
    it('chọn Gemini khi OCR_VISION_PROVIDER=gemini và Gemini có sẵn', () => {
      process.env.OCR_VISION_PROVIDER = 'gemini';
      mockGemini.isAvailable.mockReturnValue(true);

      const provider = resolver.resolve();
      expect(provider).toBe(mockGemini);
    });

    it('ném RpcException khi OCR_VISION_PROVIDER=gemini nhưng Gemini không có sẵn', () => {
      process.env.OCR_VISION_PROVIDER = 'gemini';
      mockGemini.isAvailable.mockReturnValue(false);

      expect(() => resolver.resolve()).toThrow(RpcException);
    });

    it('chọn OpenAI khi OCR_VISION_PROVIDER=openai và OpenAI có sẵn', () => {
      process.env.OCR_VISION_PROVIDER = 'openai';
      mockOpenAi.isAvailable.mockReturnValue(true);

      const provider = resolver.resolve();
      expect(provider).toBe(mockOpenAi);
    });

    it('ném RpcException khi OCR_VISION_PROVIDER=openai nhưng OpenAI không có sẵn', () => {
      process.env.OCR_VISION_PROVIDER = 'openai';
      mockOpenAi.isAvailable.mockReturnValue(false);

      expect(() => resolver.resolve()).toThrow(RpcException);
    });
  });
});
