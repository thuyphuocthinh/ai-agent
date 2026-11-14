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
import { toOpenAiStrictSchema } from './openai-strict-schema.util';
import { OpenAiChatSession } from './openai-chat-session';

@Injectable()
export class OpenAiStrategy implements LlmStrategy {
  readonly id = 'openai';
  private readonly logger = new Logger(OpenAiStrategy.name);
  private readonly client?: OpenAI;
  // Registry ghi tên model kiểu router ("openai/gpt-4o-mini"); gọi thẳng
  // api.openai.com thì API chỉ nhận "gpt-4o-mini".
  private readonly callsOpenAiDirectly: boolean;

  constructor() {
    const apiKey = process.env.OPENAI_API_KEY;
    const baseURL = process.env.AI_ROUTER_URL || 'http://localhost:20128/v1';
    this.callsOpenAiDirectly = baseURL.startsWith('https://api.openai.com');
    if (apiKey) {
      this.client = new OpenAI({
        apiKey,
        baseURL, // Trỏ thẳng vào 9Router chạy qua Docker
        maxRetries: 3,
        fetch: async (
          url: RequestInfo,
          init?: RequestInit,
        ): Promise<Response> => {
          const response = await fetch(url, init);

          // Bỏ qua nếu là stream (vì stream chunk được xử lý riêng rẽ)
          const isStream =
            init?.body &&
            typeof init.body === 'string' &&
            init.body.includes('"stream":true');
          if (isStream) {
            return response;
          }

          // KHÔNG dựa vào header content-type 9Router trả về để quyết định có dọn
          // rác hay không — 9Router có lúc gắn content-type kiểu SSE (text/event-stream)
          // cho cả request non-stream, khiến bước dọn rác bị bỏ qua đúng lúc cần nhất.
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
        'OPENAI_API_KEY is not defined in environment variables',
      );
    }
  }

  startChat(opts: LlmChatOptions): LlmChatSession {
    if (!this.client) {
      throw new RpcException(ORCHESTRATION_ERROR.LLM_PROVIDER_NOT_CONFIGURED);
    }
    return new OpenAiChatSession(this.client, {
      ...opts,
      model: this.apiModel(opts.model),
    });
  }

  private apiModel(model: string): string {
    return this.callsOpenAiDirectly ? model.replace(/^openai\//, '') : model;
  }

  async generateStructured<T>(opts: LlmStructuredOptions): Promise<T> {
    if (!this.client) {
      throw new RpcException(ORCHESTRATION_ERROR.LLM_PROVIDER_NOT_CONFIGURED);
    }

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
              { role: 'system', content: params.systemInstruction },
              { role: 'user', content: params.prompt },
            ],
            response_format: {
              type: 'json_schema',
              json_schema: {
                name: 'decision',
                schema: toOpenAiStrictSchema(params.schema),
                strict: true,
              },
            },
            temperature: 0,
          },
          { signal: opts.signal },
        )) as any;

        if (typeof completion === 'string' || completion instanceof String) {
          try {
            let cleanRaw = stripNineRouterArtifacts(completion.toString());
            // Trích xuất JSON ngoài cùng an toàn (không dùng JsonExtractor để tránh bị lừa bởi ```python bên trong content)
            const firstBrace = cleanRaw.indexOf('{');
            const lastBrace = cleanRaw.lastIndexOf('}');
            if (firstBrace !== -1 && lastBrace !== -1) {
              cleanRaw = cleanRaw.substring(firstBrace, lastBrace + 1);
            }
            completion = JSON.parse(cleanRaw);
          } catch (e) {
            // ignore, let it fail below
            this.logger.error('OpenAI Error: Failed to parse completion', e);
          }
        }

        // Giai đoạn 4, Step 7 — gắn usage/chi phí ước lượng vào chính trace
        // "openai.generateStructured" này (bên trong hàm traceable() bọc).
        // cached_tokens (ver3.md — prompt caching) log thẳng ra để kiểm tra
        // nhanh qua pm2 log, không cần mở LangSmith dashboard.
        if (completion.usage) {
          const cachedTokens =
            completion.usage.prompt_tokens_details?.cached_tokens ?? 0;
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
      { name: 'openai.generateStructured', run_type: 'llm' },
    );

    const completion = await generate({
      ...opts,
      model: this.apiModel(opts.model),
    });

    if (!completion || !completion.choices) {
      throw new Error(`9Router/OpenAI Error: ${JSON.stringify(completion)}`);
    }

    const message = completion.choices[0]?.message;
    if (message?.refusal) {
      throw new Error(
        `OpenAI refused to generate structured output: ${message.refusal}`,
      );
    }

    const text = message?.content ?? '{}';
    const extractor = new JsonExtractor();
    const cleanJson = extractor.extract(text);

    return JSON.parse(cleanJson) as T;
  }
}
