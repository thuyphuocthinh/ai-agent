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
import { AGENT_REGISTRY } from './registry/agents.registry';
import {
  MockMcpAuthClientService,
  MockMcpClientService,
  MOCK_PROVIDER_IDS,
} from './mock';

// MOCK_TOOLS=true: thay McpClientService/McpAuthClientService bằng provider giả
// (chưa có MCP thật, chỉ để test engine/playground). Quyết định lúc import nên
// biến phải được nạp từ .env TRƯỚC khi module này được import (main.ts đã làm).
const MOCK_TOOLS = process.env.MOCK_TOOLS === 'true';
if (MOCK_TOOLS) {
  // Supervisor chỉ liệt kê agent tĩnh có endpoint; mock không gọi mạng nên chỉ
  // cần 1 giá trị khác rỗng.
  for (const id of MOCK_PROVIDER_IDS) {
    AGENT_REGISTRY[id].endpoint ??= `mock://${id}`;
  }
}

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
    MOCK_TOOLS
      ? { provide: McpClientService, useClass: MockMcpClientService }
      : McpClientService,
    MOCK_TOOLS
      ? { provide: McpAuthClientService, useClass: MockMcpAuthClientService }
      : McpAuthClientService,
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
