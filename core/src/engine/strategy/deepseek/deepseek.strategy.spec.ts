import { Test, TestingModule } from '@nestjs/testing';
import { RpcException } from '@nestjs/microservices';
import { ORCHESTRATION_ERROR } from '@agent/core/constants';

const mockCreate = jest.fn();

jest.mock('openai', () => {
  const MockOpenAI = jest.fn().mockImplementation((config) => {
    (MockOpenAI as any).lastConfig = config;
    return {
      chat: { completions: { create: mockCreate } },
    };
  });
  return {
    __esModule: true,
    default: MockOpenAI,
    OpenAI: MockOpenAI,
  };
});

const mockGetCurrentRunTree = jest.fn();
jest.mock('langsmith/traceable', () => ({
  ...jest.requireActual('langsmith/traceable'),
  getCurrentRunTree: (...args: unknown[]) => mockGetCurrentRunTree(...args),
}));

import { DeepSeekStrategy } from './deepseek.strategy';
import { OpenAI } from 'openai';

function mockStream(chunks: any[]): AsyncIterable<any> {
  return {
    [Symbol.asyncIterator]() {
      let i = 0;
      return {
        next: async () =>
          i < chunks.length
            ? { value: chunks[i++], done: false }
            : { value: undefined, done: true },
      };
    },
  };
}

describe('DeepSeekStrategy', () => {
  let strategy: DeepSeekStrategy;

  const createStrategy = async (): Promise<DeepSeekStrategy> => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [DeepSeekStrategy],
    }).compile();
    return module.get<DeepSeekStrategy>(DeepSeekStrategy);
  };

  beforeEach(async () => {
    process.env.DEEPSEEK_API_KEY = 'test-deepseek-key';
    strategy = await createStrategy();
  });

  afterEach(() => {
    jest.clearAllMocks();
    delete process.env.DEEPSEEK_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.DEEPSEEK_BASE_URL;
    delete process.env.OPENAI_BASE_URL;
    delete process.env.AI_ROUTER_URL;
  });

  it('throws LLM_PROVIDER_NOT_CONFIGURED when both DEEPSEEK_API_KEY and OPENAI_API_KEY are missing', async () => {
    delete process.env.DEEPSEEK_API_KEY;
    delete process.env.OPENAI_API_KEY;
    const unconfigured = await createStrategy();

    expect(() =>
      unconfigured.startChat({
        model: 'deepseek-chat',
        systemInstruction: '',
        tools: [],
        history: [],
      }),
    ).toThrow(RpcException);
  });

  it('falls back to OPENAI_API_KEY when DEEPSEEK_API_KEY is not defined', async () => {
    delete process.env.DEEPSEEK_API_KEY;
    process.env.OPENAI_API_KEY = 'fallback-openai-key';
    const fallbackStrategy = await createStrategy();

    expect(fallbackStrategy.id).toBe('deepseek');
    expect(() =>
      fallbackStrategy.startChat({
        model: 'deepseek-chat',
        systemInstruction: '',
        tools: [],
        history: [],
      }),
    ).not.toThrow();
  });

  it('respects base URL fallback hierarchy: DEEPSEEK_BASE_URL -> OPENAI_BASE_URL -> AI_ROUTER_URL', async () => {
    delete process.env.DEEPSEEK_BASE_URL;
    process.env.OPENAI_BASE_URL = 'https://custom-openai-base.com/v1';

    await createStrategy();
    expect((OpenAI as any).lastConfig.baseURL).toBe(
      'https://custom-openai-base.com/v1',
    );

    delete process.env.OPENAI_BASE_URL;
    process.env.AI_ROUTER_URL = 'http://localhost:20128/v1';
    await createStrategy();
    expect((OpenAI as any).lastConfig.baseURL).toBe('http://localhost:20128/v1');
  });

  it('handles DeepSeek R1 reasoning stream without pushing reasoning to onToken', async () => {
    const onToken = jest.fn();
    mockCreate.mockResolvedValueOnce(
      mockStream([
        {
          choices: [
            {
              delta: {
                reasoning_content: 'Let me think about step 1...',
              },
            },
          ],
        },
        {
          choices: [
            {
              delta: {
                content: 'Here is the final answer.',
              },
            },
          ],
        },
      ]),
    );

    const session = strategy.startChat({
      model: 'deepseek-reasoner',
      systemInstruction: 'You are helpful',
      tools: [],
      history: [],
    });

    const result = await session.sendMessage('Solve this', onToken);

    // Only content was streamed to onToken, reasoning was ignored from onToken
    expect(onToken).toHaveBeenCalledTimes(1);
    expect(onToken).toHaveBeenCalledWith('Here is the final answer.');
    expect(result.text).toBe('Here is the final answer.');
  });

  it('generates structured JSON output using response_format json_object', async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [
        {
          message: {
            content: JSON.stringify({ verdict: 'APPROVED', reason: 'Looks good' }),
          },
        },
      ],
      usage: {
        prompt_tokens: 20,
        completion_tokens: 10,
      },
    });

    const res = await strategy.generateStructured<{ verdict: string }>({
      model: 'deepseek-chat',
      systemInstruction: 'Judge the request',
      prompt: 'Check this',
      schema: {
        type: 'object',
        properties: { verdict: { type: 'string' } },
        required: ['verdict'],
      },
    });

    expect(res.verdict).toBe('APPROVED');
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        response_format: { type: 'json_object' },
        temperature: 0,
      }),
      expect.anything(),
    );
  });
});
