export enum ELlmProvider {
  GEMINI = 'gemini',
  OPENAI = 'openai',
  ANTHROPIC = 'anthropic',
  DEEPSEEK = 'deepseek',
}

export type LlmStrategyId = `${ELlmProvider}`;

export interface LlmModelRegistryEntry {
  strategyId: LlmStrategyId;
  model: string;
  label: string;
  pricePerMillionInputTokens: number;
  pricePerMillionOutputTokens: number;
  contextWindowTokens: number;
}

export const LLM_MODEL_REGISTRY: Record<string, LlmModelRegistryEntry> = {
  'gemini-2.0-flash': {
    strategyId: 'gemini',
    model: 'gemini-2.0-flash',
    label: 'Gemini 2.0 Flash',
    pricePerMillionInputTokens: 0.1,
    pricePerMillionOutputTokens: 0.4,
    contextWindowTokens: 1_048_576,
  },
  'gemini-2.5-flash': {
    strategyId: 'gemini',
    model: 'gemini-2.5-flash',
    label: 'Gemini 2.5 Flash',
    pricePerMillionInputTokens: 0.3,
    pricePerMillionOutputTokens: 2.5,
    contextWindowTokens: 1_048_576,
  },
  'gemini-2.5-pro': {
    strategyId: 'gemini',
    model: 'gemini-2.5-pro',
    label: 'Gemini 2.5 Pro',
    pricePerMillionInputTokens: 1.25,
    pricePerMillionOutputTokens: 10,
    contextWindowTokens: 1_048_576,
  },
  'gemini-3.5-flash': {
    strategyId: 'gemini',
    model: 'gemini-3.5-flash',
    label: 'Gemini 3.5 Flash',
    pricePerMillionInputTokens: 0.3,
    pricePerMillionOutputTokens: 2.5,
    contextWindowTokens: 1_048_576,
  },
  'gpt-4o-mini': {
    strategyId: 'openai',
    model: 'openai/gpt-4o-mini',
    label: 'GPT-4o mini',
    pricePerMillionInputTokens: 0.15,
    pricePerMillionOutputTokens: 0.6,
    contextWindowTokens: 128_000,
  },
  'gpt-4.1-nano': {
    strategyId: 'openai',
    model: 'openai/gpt-4.1-nano',
    label: 'GPT-4.1 nano',
    pricePerMillionInputTokens: 0.1,
    pricePerMillionOutputTokens: 0.4,
    contextWindowTokens: 1_047_576,
  },
  'gpt-4o': {
    strategyId: 'openai',
    model: 'openai/gpt-4o',
    label: 'GPT-4o',
    pricePerMillionInputTokens: 2.5,
    pricePerMillionOutputTokens: 10,
    contextWindowTokens: 128_000,
  },
  'claude-haiku': {
    strategyId: 'anthropic',
    model: 'claude-3-5-haiku-20241022',
    label: 'Claude Haiku',
    pricePerMillionInputTokens: 0.8,
    pricePerMillionOutputTokens: 4,
    contextWindowTokens: 200_000,
  },
  'claude-sonnet': {
    strategyId: 'anthropic',
    model: 'claude-3-5-sonnet-20241022',
    label: 'Claude Sonnet',
    pricePerMillionInputTokens: 3,
    pricePerMillionOutputTokens: 15,
    contextWindowTokens: 200_000,
  },
  'deepseek-chat': {
    strategyId: 'deepseek',
    model: 'deepseek-chat',
    label: 'DeepSeek V3',
    pricePerMillionInputTokens: 0.14,
    pricePerMillionOutputTokens: 0.28,
    contextWindowTokens: 64_000,
  },
  'deepseek-reasoner': {
    strategyId: 'deepseek',
    model: 'deepseek-reasoner',
    label: 'DeepSeek R1',
    pricePerMillionInputTokens: 0.55,
    pricePerMillionOutputTokens: 2.19,
    contextWindowTokens: 64_000,
  },
};

export const EMBEDDING_MODEL_PRICING: Record<string, number> = {
  'text-embedding-3-small': 0.02,
};
