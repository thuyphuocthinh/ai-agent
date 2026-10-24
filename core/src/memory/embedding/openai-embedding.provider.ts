import { Injectable, Logger } from '@nestjs/common';
import OpenAI from 'openai';
import { EmbeddingProvider } from 'agentic-openapi-parser';

export const OPENAI_EMBEDDING_MODEL = 'text-embedding-3-small';
export const CHARS_PER_TOKEN_ESTIMATE = 4;

@Injectable()
export class OpenAiEmbeddingProvider implements EmbeddingProvider {
  private readonly logger = new Logger(OpenAiEmbeddingProvider.name);
  private readonly client?: OpenAI;

  constructor() {
    const apiKey = process.env.OPENAI_EMBEDDING_API_KEY;
    if (apiKey) {
      this.client = new OpenAI({ apiKey });
    } else {
      this.logger.warn(
        'OPENAI_EMBEDDING_API_KEY is not defined in environment variables — semantic tool search is unavailable.',
      );
    }
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (!this.client) {
      throw new Error(
        'OpenAiEmbeddingProvider: OPENAI_EMBEDDING_API_KEY is not configured.',
      );
    }

    const response = await this.client.embeddings.create({
      model: OPENAI_EMBEDDING_MODEL,
      input: texts,
    });

    return response.data.map((d) => d.embedding);
  }
}
