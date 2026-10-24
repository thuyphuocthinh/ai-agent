import { Module } from '@nestjs/common';
import { McpClientService } from './mcp/mcp-client.service';
import { McpAuthClientService } from './mcp/mcp-auth-client.service';
import { OpenApiParserService } from './openapi/openapi-parser.service';
import { DynamicToolRegistryService } from './registry/dynamic-tool-registry.service';
import { OpenAiEmbeddingProvider } from './registry/openai-embedding.provider';
import { DynamicToolExecutorService } from './executor/dynamic-tool-executor.service';
import { TOOL_PROVIDER } from './contracts';
import { AGENT_REGISTRY } from './registry/agents.registry';
import {
  MockMcpAuthClientService,
  MockMcpClientService,
  MOCK_PROVIDER_IDS,
} from './mock';

const MOCK_TOOLS = process.env.MOCK_TOOLS === 'true';
if (MOCK_TOOLS) {
  for (const id of MOCK_PROVIDER_IDS) {
    AGENT_REGISTRY[id].endpoint ??= `mock://${id}`;
  }
}

@Module({
  providers: [
    MOCK_TOOLS
      ? { provide: McpClientService, useClass: MockMcpClientService }
      : McpClientService,
    {
      provide: TOOL_PROVIDER,
      useExisting: McpClientService,
    },
    MOCK_TOOLS
      ? { provide: McpAuthClientService, useClass: MockMcpAuthClientService }
      : McpAuthClientService,
    OpenApiParserService,
    DynamicToolRegistryService,
    OpenAiEmbeddingProvider,
    DynamicToolExecutorService,
  ],
  exports: [
    TOOL_PROVIDER,
    McpClientService,
    McpAuthClientService,
    OpenApiParserService,
    DynamicToolRegistryService,
    OpenAiEmbeddingProvider,
    DynamicToolExecutorService,
  ],
})
export class ToolsModule {}
