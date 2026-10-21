import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DynamicProviderEntity } from '@agent/core/entity/dynamic-provider.entity';
import { McpClientService } from './mcp/mcp-client.service';
import { McpAuthClientService } from './mcp/mcp-auth-client.service';
import { OpenApiParserService } from './openapi/openapi-parser.service';
import { DynamicToolRegistryService } from './registry/dynamic-tool-registry.service';
import { DynamicProviderDbService } from './registry/dynamic-provider-db.service';
import { ProviderSummaryService } from './registry/provider-summary.service';
import { OpenAiEmbeddingProvider } from './registry/openai-embedding.provider';
import { DynamicToolExecutorService } from './executor/dynamic-tool-executor.service';
import {
  CircuitBreakerService,
  MetricsRegistryService,
  ProviderConcurrencyLimiterService,
} from '@agent/core/common';

@Module({
  imports: [
    TypeOrmModule.forFeature([DynamicProviderEntity]),
  ],
  providers: [
    // CircuitBreakerService inject MetricsRegistryService; thiếu dòng này thì
    // ToolsModule không tự dựng được khi tách khỏi host (Registry riêng của
    // prom-client nên không đụng instance của OrchestrationModule).
    MetricsRegistryService,
    CircuitBreakerService,
    ProviderConcurrencyLimiterService,
    McpClientService,
    McpAuthClientService,
    OpenApiParserService,
    DynamicToolRegistryService,
    DynamicProviderDbService,
    ProviderSummaryService,
    OpenAiEmbeddingProvider,
    DynamicToolExecutorService,
  ],
  exports: [
    CircuitBreakerService,
    ProviderConcurrencyLimiterService,
    McpClientService,
    McpAuthClientService,
    OpenApiParserService,
    DynamicToolRegistryService,
    DynamicProviderDbService,
    ProviderSummaryService,
    OpenAiEmbeddingProvider,
    DynamicToolExecutorService,
  ],
})
export class ToolsModule {}
