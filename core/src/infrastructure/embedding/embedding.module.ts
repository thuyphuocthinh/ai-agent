import { Module } from '@nestjs/common';
import { OpenAiEmbeddingProvider } from './openai-embedding.provider';

@Module({
  providers: [OpenAiEmbeddingProvider],
  exports: [OpenAiEmbeddingProvider],
})
export class EmbeddingModule {}
