import { Injectable, Logger } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import { JsonExtractor } from 'agentic-io-parser';
import OpenAI from 'openai';
import { traceable } from 'langsmith/traceable';
import { ORCHESTRATION_ERROR } from '@agent/core/constants';
import {
  LlmChatOptions,
  LlmChatSession,
  LlmStrategy,
  LlmStructuredOptions,
} from '../../../contracts/engine/llm-strategy.interface';
import { attachLlmCostMetadata } from '../../../common/text/llm-cost.util';
import { stripNineRouterArtifacts } from '../../../common/text/router-artifact.util';
import { DeepSeekChatSession } from './deepseek-chat-session';

@Injectable()
export class DeepSeekStrategy implements LlmStrategy {
  readonly id = 'deepseek';
  private readonly logger = new Logger(DeepSeekStrategy.name);
  private readonly client?: OpenAI;
  private readonly baseURL: string;

  constructor() {
    const apiKey =
      process.env.DEEPSEEK_API_KEY || process.env.OPENAI_API_KEY;
    this.baseURL =
      process.env.DEEPSEEK_BASE_URL ||
      process.env.OPENAI_BASE_URL ||
      process.env.AI_ROUTER_URL ||
      'https://api.deepseek.com/v1';

    if (apiKey) {
      this.client = new OpenAI({
        apiKey,
        baseURL: this.baseURL,
        maxRetries: 3,
        fetch: async (
          url: RequestInfo,
          init?: RequestInit,
        ): Promise<Response> => {
          const response = await fetch(url, init);

          const isStream =
            init?.body &&
            typeof init.body === 'string' &&
            init.body.includes('"stream":true');
          if (isStream) {
            return response;
          }

          const text = await response.text();
          return new Response(stripNineRouterArtifacts(text), {
            status: response.status,
            statusText: response.statusText,
            headers: response.headers,
          });
        },
      });
    } else {
      this.logger.warn(
        'Neither DEEPSEEK_API_KEY nor OPENAI_API_KEY is defined in environment variables',
      );
    }
  }

  startChat(opts: LlmChatOptions): LlmChatSession {
    if (!this.client) {
      throw new RpcException(ORCHESTRATION_ERROR.LLM_PROVIDER_NOT_CONFIGURED);
    }
    return new DeepSeekChatSession(this.client, {
      ...opts,
      model: this.apiModel(opts.model),
    });
  }

  private apiModel(model: string): string {
    const isDirect = this.baseURL.includes('api.deepseek.com');
    return isDirect ? model.replace(/^deepseek\//, '') : model;
  }

  async generateStructured<T>(opts: LlmStructuredOptions): Promise<T> {
    if (!this.client) {
      throw new RpcException(ORCHESTRATION_ERROR.LLM_PROVIDER_NOT_CONFIGURED);
    }

    const schemaInstruction = `\nYou MUST respond with a valid JSON object matching this schema:\n${JSON.stringify(
      opts.schema,
    )}`;

    const generate = traceable(
      async (params: {
        model: string;
        systemInstruction: string;
        prompt: string;
        schema: Record<string, unknown>;
      }) => {
        let completion = (await this.client!.chat.completions.create(
          {
            model: params.model,
            messages: [
              {
                role: 'system',
                content: params.systemInstruction + schemaInstruction,
              },
              { role: 'user', content: params.prompt },
            ],
            response_format: { type: 'json_object' },
            temperature: 0,
          },
          { signal: opts.signal },
        )) as any;

        if (typeof completion === 'string' || completion instanceof String) {
          try {
            let cleanRaw = stripNineRouterArtifacts(completion.toString());
            const firstBrace = cleanRaw.indexOf('{');
            const lastBrace = cleanRaw.lastIndexOf('}');
            if (firstBrace !== -1 && lastBrace !== -1) {
              cleanRaw = cleanRaw.substring(firstBrace, lastBrace + 1);
            }
            completion = JSON.parse(cleanRaw);
          } catch (e) {
            this.logger.error('DeepSeek Error: Failed to parse completion', e);
          }
        }

        if (completion.usage) {
          const cachedTokens =
            completion.usage.prompt_tokens_details?.cached_tokens ??
            completion.usage.prompt_cache_hit_tokens ??
            0;
          this.logger.log(
            `generateStructured() usage model=${params.model} input=${completion.usage.prompt_tokens} cached=${cachedTokens} output=${completion.usage.completion_tokens}`,
          );
          attachLlmCostMetadata(params.model, {
            inputTokens: completion.usage.prompt_tokens,
            outputTokens: completion.usage.completion_tokens,
            cachedTokens,
          });
        }
        return completion;
      },
      { name: 'deepseek.generateStructured', run_type: 'llm' },
    );

    const completion = await generate({
      ...opts,
      model: this.apiModel(opts.model),
    });

    if (!completion || !completion.choices) {
      throw new Error(`DeepSeek Error: ${JSON.stringify(completion)}`);
    }

    const message = completion.choices[0]?.message;
    if (message?.refusal) {
      throw new Error(
        `DeepSeek refused to generate structured output: ${message.refusal}`,
      );
    }

    const text = message?.content ?? '{}';
    const extractor = new JsonExtractor();
    const cleanJson = extractor.extract(text);

    return JSON.parse(cleanJson) as T;
  }
}
