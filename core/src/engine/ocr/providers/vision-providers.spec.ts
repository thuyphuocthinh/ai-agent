import { GeminiVisionProvider } from './gemini-vision.provider';
import { OpenAiVisionProvider } from './openai-vision.provider';

describe('Vision Providers', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
    jest.restoreAllMocks();
  });

  describe('GeminiVisionProvider', () => {
    it('isAvailable trả về false khi không có GEMINI_API_KEY', () => {
      delete process.env.GEMINI_API_KEY;
      const provider = new GeminiVisionProvider();
      expect(provider.isAvailable()).toBe(false);
    });

    it('isAvailable trả về true khi có GEMINI_API_KEY', () => {
      process.env.GEMINI_API_KEY = 'test-gemini-key';
      const provider = new GeminiVisionProvider();
      expect(provider.isAvailable()).toBe(true);
    });

    it('generateText ném lỗi nếu client chưa được khởi tạo', async () => {
      delete process.env.GEMINI_API_KEY;
      const provider = new GeminiVisionProvider();
      await expect(
        provider.generateText({
          mimeType: 'image/png',
          base64Data: 'abc',
          systemPrompt: 'prompt',
          userInstruction: 'instruction',
        }),
      ).rejects.toThrow('GeminiVisionProvider chưa được cấu hình API key');
    });

    it('generateText gọi client.getGenerativeModel và trả về text', async () => {
      process.env.GEMINI_API_KEY = 'test-gemini-key';
      const provider = new GeminiVisionProvider();

      const mockGenerateContent = jest.fn().mockResolvedValue({
        response: { text: () => '  Mock Gemini Output  ' },
      });

      (provider as unknown as { client: { getGenerativeModel: jest.Mock } }).client = {
        getGenerativeModel: jest.fn().mockReturnValue({ generateContent: mockGenerateContent }),
      };

      const result = await provider.generateText({
        mimeType: 'image/png',
        base64Data: 'mock-base64',
        systemPrompt: 'sys-prompt',
        userInstruction: 'user-prompt',
      });

      expect(result).toBe('Mock Gemini Output');
      expect(mockGenerateContent).toHaveBeenCalledWith([
        { text: 'user-prompt' },
        { inlineData: { mimeType: 'image/png', data: 'mock-base64' } },
      ]);
    });
  });

  describe('OpenAiVisionProvider', () => {
    it('isAvailable trả về false khi không có OPENAI_API_KEY', () => {
      delete process.env.OPENAI_API_KEY;
      const provider = new OpenAiVisionProvider();
      expect(provider.isAvailable()).toBe(false);
    });

    it('isAvailable trả về true khi có OPENAI_API_KEY', () => {
      process.env.OPENAI_API_KEY = 'test-openai-key';
      const provider = new OpenAiVisionProvider();
      expect(provider.isAvailable()).toBe(true);
    });

    it('generateText ném lỗi nếu client chưa được khởi tạo', async () => {
      delete process.env.OPENAI_API_KEY;
      const provider = new OpenAiVisionProvider();
      await expect(
        provider.generateText({
          mimeType: 'image/png',
          base64Data: 'abc',
          systemPrompt: 'prompt',
          userInstruction: 'instruction',
        }),
      ).rejects.toThrow('OpenAiVisionProvider chưa được cấu hình API key');
    });

    it('generateText gọi chat.completions.create với image_url và trả về content', async () => {
      process.env.OPENAI_API_KEY = 'test-openai-key';
      const provider = new OpenAiVisionProvider();

      const mockCreate = jest.fn().mockResolvedValue({
        choices: [{ message: { content: '  Mock OpenAI Vision Output  ' } }],
      });

      (provider as unknown as { client: { chat: { completions: { create: jest.Mock } } } }).client = {
        chat: { completions: { create: mockCreate } },
      };

      const result = await provider.generateText({
        mimeType: 'image/png',
        base64Data: 'mock-base64',
        systemPrompt: 'sys-prompt',
        userInstruction: 'user-prompt',
      });

      expect(result).toBe('Mock OpenAI Vision Output');
      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: [
            { role: 'system', content: 'sys-prompt' },
            {
              role: 'user',
              content: [
                { type: 'text', text: 'user-prompt' },
                {
                  type: 'image_url',
                  image_url: {
                    url: 'data:image/png;base64,mock-base64',
                    detail: 'high',
                  },
                },
              ],
            },
          ],
        }),
      );
    });
  });
});
