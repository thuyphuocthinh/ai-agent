import { Test, TestingModule } from '@nestjs/testing';
import { RpcException } from '@nestjs/microservices';
import { ORCHESTRATION_ERROR } from '@agent/core/constants';
import { LlmStrategyFactory } from './llm-strategy.factory';
import { GeminiStrategy } from './gemini/gemini.strategy';
import { OpenAiStrategy } from './openai/openai.strategy';
import { AnthropicStrategy } from './anthropic/anthropic.strategy';
import { DeepSeekStrategy } from './deepseek/deepseek.strategy';
import { MockStrategy } from './mock/mock.strategy';

describe('LlmStrategyFactory', () => {
  let factory: LlmStrategyFactory;

  const mockGemini = { id: 'gemini' };
  const mockOpenAi = { id: 'openai' };
  const mockAnthropic = { id: 'anthropic' };
  const mockDeepSeek = { id: 'deepseek' };
  const mockMockStrategy = { id: 'mock' };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LlmStrategyFactory,
        { provide: GeminiStrategy, useValue: mockGemini },
        { provide: OpenAiStrategy, useValue: mockOpenAi },
        { provide: AnthropicStrategy, useValue: mockAnthropic },
        { provide: DeepSeekStrategy, useValue: mockDeepSeek },
        { provide: MockStrategy, useValue: mockMockStrategy },
      ],
    }).compile();

    factory = module.get<LlmStrategyFactory>(LlmStrategyFactory);
  });

  afterEach(() => jest.clearAllMocks());

  it('resolves a Gemini model id to the Gemini strategy + real SDK model name', () => {
    const result = factory.resolve('gemini-2.0-flash');
    expect(result.strategy).toBe(mockGemini);
    expect(result.model).toBe('gemini-2.0-flash');
  });

  it('resolves an OpenAI model id to the OpenAI strategy', () => {
    const result = factory.resolve('gpt-4o-mini');
    expect(result.strategy).toBe(mockOpenAi);
    expect(result.model).toBe('openai/gpt-4o-mini');
  });

  it('resolves an Anthropic model id to the Anthropic strategy', () => {
    const result = factory.resolve('claude-haiku');
    expect(result.strategy).toBe(mockAnthropic);
  });

  it('resolves registered DeepSeek models to DeepSeek strategy', () => {
    const chatResult = factory.resolve('deepseek-chat');
    expect(chatResult.strategy).toBe(mockDeepSeek);
    expect(chatResult.model).toBe('deepseek-chat');

    const reasonerResult = factory.resolve('deepseek-reasoner');
    expect(reasonerResult.strategy).toBe(mockDeepSeek);
    expect(reasonerResult.model).toBe('deepseek-reasoner');
  });

  describe('Heuristic Auto-detection (Dynamic Model Names)', () => {
    it('auto-detects unregistered DeepSeek models', () => {
      const res = factory.resolve('deepseek-coder-v2');
      expect(res.strategy).toBe(mockDeepSeek);
      expect(res.model).toBe('deepseek-coder-v2');
    });

    it('auto-detects unregistered OpenAI models (gpt, o1, o3)', () => {
      const gptRes = factory.resolve('gpt-4.5-preview');
      expect(gptRes.strategy).toBe(mockOpenAi);
      expect(gptRes.model).toBe('gpt-4.5-preview');

      const o3Res = factory.resolve('o3-mini');
      expect(o3Res.strategy).toBe(mockOpenAi);
      expect(o3Res.model).toBe('o3-mini');
    });

    it('auto-detects unregistered Anthropic models (claude-*)', () => {
      const res = factory.resolve('claude-3-7-sonnet');
      expect(res.strategy).toBe(mockAnthropic);
      expect(res.model).toBe('claude-3-7-sonnet');
    });

    it('auto-detects unregistered Gemini models (gemini-*)', () => {
      const res = factory.resolve('gemini-1.5-flash-8b');
      expect(res.strategy).toBe(mockGemini);
      expect(res.model).toBe('gemini-1.5-flash-8b');
    });
  });

  it('throws RpcException with UNKNOWN_LLM_MODEL for completely unrecognized model id', () => {
    expect(() => factory.resolve('totally-unknown-model-xyz')).toThrow(
      RpcException,
    );
    try {
      factory.resolve('totally-unknown-model-xyz');
      fail('expected resolve() to throw');
    } catch (error) {
      expect((error as RpcException).getError()).toEqual(
        ORCHESTRATION_ERROR.UNKNOWN_LLM_MODEL,
      );
    }
  });

  it('returns mock strategy when LOAD_TEST_MODE is true', () => {
    process.env.LOAD_TEST_MODE = 'true';
    try {
      const res = factory.resolve('gpt-4o');
      expect(res.strategy).toBe(mockMockStrategy);
      expect(res.model).toBe('mock-model');
    } finally {
      delete process.env.LOAD_TEST_MODE;
    }
  });
});
