import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScheduleModule } from '@nestjs/schedule';
import { DatabaseModule } from '@agent/core/infrastructure/database';
import { QueueModule, EQueueName } from '@agent/core/infrastructure/queue';
import { CachedModule } from '@agent/core/infrastructure/redis';
import { AiOrchestrationProcessor } from './orchestrator/ai-orchestration.processor';
import { DynamicProviderProcessor } from './orchestrator/dynamic-provider.processor';
import { McpClientService } from './tools/mcp/mcp-client.service';
import { McpAuthClientService } from './tools/mcp/mcp-auth-client.service';
import { ReactLoopService } from './loop/react-loop.service';
import { SupervisorService } from './supervisor/supervisor.service';
import { AgentRankingService } from './supervisor/agent-ranking.service';
import { SupervisorPromptBuilder } from './supervisor/supervisor-prompt.builder';
import { LlmStrategyFactory } from './strategy/llm-strategy.factory';
import { GeminiStrategy } from './strategy/gemini.strategy';
import { OpenAiStrategy } from './strategy/openai.strategy';
import { AnthropicStrategy } from './strategy/anthropic.strategy';
import { MockStrategy } from './strategy/mock.strategy';
import { OrchestrationCheckpointEntity } from './entity/orchestration-checkpoint.entity';
import { OrchestrationTriggerClaimEntity } from './entity/orchestration-trigger-claim.entity';
import { DynamicProviderEntity } from './entity/dynamic-provider.entity';
import { ChannelMemoryEntity } from './entity/channel-memory.entity';
import { SkillEntity } from './entity/skill.entity';
import { ChannelMemoryService } from './memory/channel-memory.service';
import { ChannelMemoryCleanupService } from './memory/channel-memory-cleanup.service';
import { MemoryManagerService } from './memory/memory-manager.service';
import { SkillService } from './memory/skill.service';
import { SkillRetrievalService } from './memory/skill-retrieval.service';
import { CheckpointService } from './hitl/checkpoint.service';
import { CheckpointCleanupService } from './hitl/checkpoint-cleanup.service';
import { TriggerClaimService } from './hitl/trigger-claim.service';
import { CircuitBreakerService } from './common/circuit-breaker.service';
import { ProviderConcurrencyLimiterService } from './common/provider-concurrency-limiter.service';
import { OpenApiParserService } from './tools/openapi/openapi-parser.service';
import { DynamicToolRegistryService } from './tools/registry/dynamic-tool-registry.service';
import { DynamicProviderDbService } from './tools/registry/dynamic-provider-db.service';
import { ProviderSummaryService } from './tools/registry/provider-summary.service';
import { OpenAiEmbeddingProvider } from './tools/registry/openai-embedding.provider';
import { DynamicToolExecutorService } from './tools/executor/dynamic-tool-executor.service';
import { AgentCancellationService } from './cancellation/agent-cancellation.service';
import { TurnResolverService } from './orchestrator/turn-resolver.service';
import { CheckpointPauseService } from './hitl/checkpoint-pause.service';
import { ApprovalRequestService } from './hitl/approval-request.service';
import { ApprovalExecutionService } from './hitl/approval-execution.service';
import { ApprovalContinuationPlannerService } from './hitl/approval-continuation-planner.service';
import { ApprovalSkillRecorderService } from './hitl/approval-skill-recorder.service';
import { MessageClientService, AgentStreamService } from './contracts';
import { CliService } from './interfaces/cli/cli.service';
import { MetricsRegistryService } from './common/metrics-registry.service';
import { HealthCheckService } from './common/health-check.service';

@Module({
  imports: [
    DatabaseModule,
    TypeOrmModule.forFeature([
      OrchestrationCheckpointEntity,
      OrchestrationTriggerClaimEntity,
      DynamicProviderEntity,
      ChannelMemoryEntity,
      SkillEntity,
    ]),
    ScheduleModule.forRoot(),
    CachedModule.forRoot(),
    QueueModule.forRoot(),
    QueueModule.forFeature([
      EQueueName.AI_ORCHESTRATION_QUEUE,
      EQueueName.DYNAMIC_PROVIDER_QUEUE,
    ]),
  ],
  providers: [
    AiOrchestrationProcessor,
    DynamicProviderProcessor,
    McpClientService,
    McpAuthClientService,
    OpenApiParserService,
    DynamicToolRegistryService,
    DynamicProviderDbService,
    ProviderSummaryService,
    OpenAiEmbeddingProvider,
    DynamicToolExecutorService,
    ReactLoopService,
    SupervisorService,
    AgentRankingService,
    SupervisorPromptBuilder,
    LlmStrategyFactory,
    GeminiStrategy,
    OpenAiStrategy,
    AnthropicStrategy,
    MockStrategy,
    CheckpointService,
    CheckpointCleanupService,
    ChannelMemoryService,
    ChannelMemoryCleanupService,
    MemoryManagerService,
    SkillService,
    SkillRetrievalService,
    TriggerClaimService,
    CircuitBreakerService,
    ProviderConcurrencyLimiterService,
    AgentCancellationService,
    TurnResolverService,
    CheckpointPauseService,
    ApprovalRequestService,
    ApprovalExecutionService,
    ApprovalContinuationPlannerService,
    ApprovalSkillRecorderService,
    MessageClientService,
    AgentStreamService,
    CliService,
    MetricsRegistryService,
    HealthCheckService,
  ],
  exports: [
    AiOrchestrationProcessor,
    ReactLoopService,
    SupervisorService,
    LlmStrategyFactory,
    MessageClientService,
    AgentStreamService,
    CliService,
    McpClientService,
  ],
})
export class OrchestrationModule {}
