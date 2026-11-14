import { Logger } from '@nestjs/common';
import { JsonRepair } from 'agentic-io-parser';
import OpenAI from 'openai';
import type {
  ChatCompletionAssistantMessageParam,
  ChatCompletionMessageParam,
  ChatCompletionTool,
} from 'openai/resources/chat/completions';
import { traceable } from 'langsmith/traceable';
import {
  LlmChatOptions,
  LlmChatSession,
  LlmToolResult,
  LlmTurnResult,
} from '../../../contracts/engine/llm-strategy.interface';
import { attachLlmCostMetadata } from '../../../common/text/llm-cost.util';

export class DeepSeekChatSession implements LlmChatSession {
  private readonly logger = new Logger(DeepSeekChatSession.name);
  private readonly model: string;
  private readonly temperature?: number;
  private readonly tools: ChatCompletionTool[];
  private readonly messages: ChatCompletionMessageParam[];
  private pendingInput: string | LlmToolResult[] | null = null;
  private readonly tracedSend: (
    input: string | LlmToolResult[],
    onToken?: (chunk: string) => void,
    signal?: AbortSignal,
  ) => Promise<LlmTurnResult>;

  constructor(
    private readonly client: OpenAI,
    opts: LlmChatOptions,
  ) {
    this.model = opts.model;
    this.temperature = opts.temperature;
    this.tools = opts.tools.map((t) => ({
      type: 'function',
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      },
    }));
    this.messages = [
      { role: 'system', content: opts.systemInstruction },
      ...opts.history.map(
        (h): ChatCompletionMessageParam => ({
          role: h.role === 'model' ? 'assistant' : 'user',
          content: h.text,
        }),
      ),
    ];
    this.tracedSend = traceable(this.rawSend.bind(this), {
      name: 'deepseek.sendMessage',
      run_type: 'llm',
    }) as (
      input: string | LlmToolResult[],
      onToken?: (chunk: string) => void,
      signal?: AbortSignal,
    ) => Promise<LlmTurnResult>;
  }

  sendMessage(
    input: string | LlmToolResult[],
    onToken?: (chunk: string) => void,
    signal?: AbortSignal,
  ): Promise<LlmTurnResult> {
    return this.tracedSend(input, onToken, signal);
  }

  private async rawSend(
    input: string | LlmToolResult[],
    onToken?: (chunk: string) => void,
    signal?: AbortSignal,
  ): Promise<LlmTurnResult> {
    if (input !== this.pendingInput) {
      this.pendingInput = input;
      if (typeof input === 'string') {
        this.messages.push({ role: 'user', content: input });
      } else {
        for (const result of input) {
          this.messages.push({
            role: 'tool',
            tool_call_id: result.id ?? result.name,
            content: result.content,
          });
        }
      }
    }

    const stream = await this.client.chat.completions.create(
      {
        model: this.model,
        messages: this.messages,
        tools: this.tools.length > 0 ? this.tools : undefined,
        temperature: this.temperature,
        stream: true,
        stream_options: { include_usage: true },
      },
      { signal },
    );

    let fullText = '';
    let finishReason: string | null = null;
    const toolCallsMap: Record<number, any> = {};
    let usage:
      | {
          prompt_tokens: number;
          completion_tokens: number;
          prompt_tokens_details?: { cached_tokens?: number };
        }
      | undefined;

    for await (const chunk of stream) {
      if (chunk.usage) {
        usage = chunk.usage;
      }

      finishReason = chunk.choices?.[0]?.finish_reason ?? finishReason;

      const delta = chunk.choices?.[0]?.delta;
      if (!delta) {
        if ((chunk as any).error) {
          throw new Error(
            `DeepSeek Stream Error: ${(chunk as any).error.message || JSON.stringify((chunk as any).error)}`,
          );
        }
        continue;
      }

      // Xử lý khối suy luận của DeepSeek R1 (reasoning_content):
      // Chỉ log nội bộ để trace/debug, KHÔNG stream ra UI để đảm bảo giao diện sạch và đồng nhất
      if ((delta as any).reasoning_content) {
        this.logger.debug(
          `[DeepSeek R1 reasoning] ${(delta as any).reasoning_content}`,
        );
      }

      // Chỉ stream nội dung câu trả lời chính thức ra UI
      if (delta.content) {
        fullText += delta.content;
        if (onToken) {
          onToken(delta.content);
        }
      }

      if (delta.tool_calls) {
        for (const call of delta.tool_calls) {
          if (!toolCallsMap[call.index]) {
            toolCallsMap[call.index] = {
              id: call.id,
              type: 'function',
              function: { name: call.function?.name || '', arguments: '' },
            };
          }
          if (call.function?.arguments) {
            toolCallsMap[call.index].function.arguments +=
              call.function.arguments;
          }
        }
      }
    }

    const toolCalls = Object.values(toolCallsMap).map((call: any) => ({
      id: call.id,
      name: call.function.name,
      args: this.safeParseArgs(call.function.arguments),
    }));

    if (finishReason === 'length' && toolCalls.length > 0) {
      throw new Error(
        'DeepSeek response truncated (max_tokens) while generating a tool call — arguments may be incomplete',
      );
    }

    if (signal?.aborted) {
      throw new Error('Aborted — request cũ đã bị bỏ do timeout/retry');
    }

    this.pendingInput = null;
    this.messages.push({
      role: 'assistant',
      content: fullText || null,
      tool_calls:
        Object.values(toolCallsMap).length > 0
          ? Object.values(toolCallsMap)
          : undefined,
    } as ChatCompletionAssistantMessageParam);

    if (usage) {
      const cachedTokens =
        usage.prompt_tokens_details?.cached_tokens ??
        (usage as any).prompt_cache_hit_tokens ??
        0;
      this.logger.log(
        `sendMessage() usage model=${this.model} input=${usage.prompt_tokens} cached=${cachedTokens} output=${usage.completion_tokens}`,
      );
      attachLlmCostMetadata(this.model, {
        inputTokens: usage.prompt_tokens,
        outputTokens: usage.completion_tokens,
        cachedTokens,
      });
    }

    return { text: fullText, toolCalls };
  }

  private safeParseArgs(raw: string): Record<string, unknown> {
    try {
      const repair = new JsonRepair();
      const repaired = repair.repair(raw || '{}');
      const parsed = JSON.parse(repaired);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed;
      }
      return {};
    } catch {
      return {};
    }
  }
}
