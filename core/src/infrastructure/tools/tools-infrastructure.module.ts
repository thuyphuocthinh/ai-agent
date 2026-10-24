import { Module } from '@nestjs/common';
import { TOOL_PROVIDER } from '../../contracts/tool-provider.interface';
import { McpToolConnectorService } from './mcp-tool-connector.service';
import { MockToolConnectorService } from './mock-tool-connector.service';
import { McpAuthClientService } from './mcp-auth-client.service';
import {
  CoreOpenApiParserService,
  CoreDynamicToolRegistryService,
} from './dynamic-tool-registry.port';
import { CircuitBreakerService } from '../../common/circuit-breaker.service';
import { ProviderConcurrencyLimiterService } from '../../common/provider-concurrency-limiter.service';

const MOCK_TOOLS = process.env.MOCK_TOOLS === 'true';

@Module({
  providers: [
    CircuitBreakerService,
    ProviderConcurrencyLimiterService,
    McpAuthClientService,
    CoreOpenApiParserService,
    CoreDynamicToolRegistryService,
    MockToolConnectorService,
    McpToolConnectorService,
    {
      provide: TOOL_PROVIDER,
      useExisting: MOCK_TOOLS ? MockToolConnectorService : McpToolConnectorService,
    },
  ],
  exports: [
    TOOL_PROVIDER,
    McpAuthClientService,
    McpToolConnectorService,
    MockToolConnectorService,
    CoreOpenApiParserService,
    CoreDynamicToolRegistryService,
  ],
})
export class ToolsInfrastructureModule {}
