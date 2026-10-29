import { Module } from '@nestjs/common';
import { TOOL_PROVIDER } from '../../contracts/tools/tool-provider.interface';
import { DatabaseModule } from '../database/database.module';
import { QueueService, EJobName, EQueueName } from '../queue';
import { ResilienceModule } from '../resilience/resilience.module';
import { EmbeddingModule } from '../embedding/embedding.module';
import { McpToolConnectorService } from './mcp/mcp-tool-connector.service';
import { MockToolConnectorService } from './mock/mock-tool-connector.service';
import { McpAuthClientService } from './mcp/mcp-auth-client.service';
import { OpenApiParserService } from './openapi/openapi-parser.service';
import { DYNAMIC_PROVIDER_LOADER } from './dynamic/dynamic-tool.interface';
import { DynamicToolRegistryService } from './dynamic/dynamic-tool-registry.service';
import {
  DynamicToolExecutorService,
  ON_TOKEN_REFRESHED,
  type TokenRefreshPayload,
} from './dynamic/dynamic-tool-executor.service';
import { DynamicProviderRepository } from './dynamic/dynamic-provider.repository';
import { DynamicProviderService } from './dynamic/dynamic-provider.service';
import { NativeToolRegistryService } from './native/native-tool-registry.service';
import { ProviderSummaryService } from './dynamic/provider-summary.service';

const MOCK_TOOLS = process.env.MOCK_TOOLS === 'true';

@Module({
  imports: [DatabaseModule, ResilienceModule, EmbeddingModule],
  providers: [
    McpAuthClientService,
    OpenApiParserService,
    DynamicToolRegistryService,
    DynamicToolExecutorService,
    NativeToolRegistryService,
    DynamicProviderRepository,
    DynamicProviderService,
    ProviderSummaryService,
    { provide: DYNAMIC_PROVIDER_LOADER, useExisting: DynamicProviderRepository },
    {
      provide: ON_TOKEN_REFRESHED,
      useFactory: (queueService: QueueService) => {
        return (payload: TokenRefreshPayload) =>
          queueService.addJob(
            EQueueName.DYNAMIC_PROVIDER_QUEUE,
            EJobName.UPDATE_DYNAMIC_PROVIDER_TOKEN,
            payload,
            {
              attempts: 3,
              backoff: { type: 'exponential', delay: 1000 },
              removeOnComplete: true,
            },
          );
      },
      inject: [QueueService],
    },
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
    OpenApiParserService,
    DynamicToolRegistryService,
    DynamicToolExecutorService,
    NativeToolRegistryService,
    DynamicProviderService,
    ProviderSummaryService,
  ],
})
export class ToolsInfrastructureModule {}
