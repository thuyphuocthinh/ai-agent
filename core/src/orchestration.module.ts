import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DatabaseModule } from './infrastructure/database/database.module';
import {
  PrismaChatSessionManager,
  PrismaMessageSink,
  PrismaCheckpointService,
  PrismaTriggerClaimService,
  PrismaWorkflowStore,
} from './infrastructure/database';
import { CachedModule } from './infrastructure/redis/redis.module';
import { QueueModule } from './infrastructure/queue/queue.module';
import { EQueueName } from './infrastructure/queue';
import { AiOrchestrationProcessor } from './engine/orchestrator/ai-orchestration.processor';
import { DynamicProviderProcessor } from './engine/orchestrator/dynamic-provider.processor';
import { ReactLoopService } from './engine/loop/react-loop.service';
import { SupervisorService } from './engine/supervisor/supervisor.service';
import { AgentRankingService } from './engine/supervisor/agent-ranking.service';
import { SupervisorPromptBuilder } from './engine/supervisor/supervisor-prompt.builder';
import { LlmStrategyFactory } from './engine/strategy/llm-strategy.factory';
import { GeminiStrategy } from './engine/strategy/gemini.strategy';
import { OpenAiStrategy } from './engine/strategy/openai.strategy';
import { AnthropicStrategy } from './engine/strategy/anthropic.strategy';
import { MockStrategy } from './engine/strategy/mock.strategy';
import { OrchestrationCheckpointEntity } from './infrastructure/database/entities/orchestration-checkpoint.entity';
import { OrchestrationTriggerClaimEntity } from './infrastructure/database/entities/orchestration-trigger-claim.entity';
import { DynamicProviderEntity } from './infrastructure/database/entities/dynamic-provider.entity';
import { ConversationMemoryEntity } from './infrastructure/database/entities/conversation-memory.entity';
import { SkillEntity } from './infrastructure/database/entities/skill.entity';
import { ConversationMemoryService } from './memory/conversation-memory.service';
import { ConversationMemoryCleanupService } from './memory/conversation-memory-cleanup.service';
import { MemoryManagerService } from './memory/memory-manager.service';
import { SkillService } from './memory/skill.service';
import { SkillRetrievalService } from './memory/skill-retrieval.service';
import { CheckpointService } from './engine/hitl/checkpoint.service';
import { CheckpointCleanupService } from './engine/hitl/checkpoint-cleanup.service';
import { TriggerClaimService } from './engine/hitl/trigger-claim.service';
import { CircuitBreakerService } from './common/circuit-breaker.service';
import { ProviderConcurrencyLimiterService } from './common/provider-concurrency-limiter.service';
import { McpToolConnectorService } from './infrastructure/tools/mcp-tool-connector.service';
import { MockToolConnectorService } from './infrastructure/tools/mock-tool-connector.service';
import { McpAuthClientService } from './infrastructure/tools/mcp-auth-client.service';
import {
  CoreOpenApiParserService,
  CoreDynamicToolRegistryService,
  DYNAMIC_PROVIDER_LOADER,
  ON_TOKEN_REFRESHED,
  TokenRefreshPayload,
} from './infrastructure/tools/dynamic-tool-registry.port';
import {
  TOOL_PROVIDER,
  CIRCUIT_BREAKER,
  PROVIDER_CONCURRENCY_LIMITER,
} from './contracts/tool-provider.interface';
import { OpenAiEmbeddingProvider } from './memory/embedding/openai-embedding.provider';
import { DynamicProviderDbService } from './engine/orchestrator/dynamic-provider-db.service';
import { ProviderSummaryService } from './engine/orchestrator/provider-summary.service';
import { QueueService, EJobName } from './infrastructure/queue';
import { AgentCancellationService } from './engine/cancellation/agent-cancellation.service';
import { TurnResolverService } from './engine/orchestrator/turn-resolver.service';
import { ExecutionEngineRegistryService } from './engine/orchestrator/execution-engine-registry.service';
import { SingleAgentEngine } from './engine/orchestrator/single-agent.engine';
import { PipelineChainingEngine } from './engine/orchestrator/pipeline-chaining.engine';
import { ParallelFanoutEngine } from './engine/orchestrator/parallel-fanout.engine';
import { DynamicSupervisorEngine } from './engine/orchestrator/dynamic-supervisor.engine';
import { SubAgentSpawnerService } from './engine/orchestrator/sub-agent-spawner.service';
import { SmartExecutionRouter } from './engine/orchestrator/smart-execution-router.service';
import {
  EXECUTION_ENGINE_REGISTRY,
  EXECUTION_ROUTER,
  IExecutionEngine,
} from './contracts/execution-engine.interface';
import { WorkflowRegistryService } from './engine/workflow/workflow-registry.service';
import { WorkflowRunnerService } from './engine/workflow/workflow-runner.service';
import { CheckpointPauseService } from './engine/hitl/checkpoint-pause.service';
import { ApprovalRequestService } from './engine/hitl/approval-request.service';
import { ApprovalExecutionService } from './engine/hitl/approval-execution.service';
import { ApprovalContinuationPlannerService } from './engine/hitl/approval-continuation-planner.service';
import { ApprovalSkillRecorderService } from './engine/hitl/approval-skill-recorder.service';
import {
  MessageClientService,
  AgentStreamService,
  MESSAGE_SINK,
  STREAM_SINK,
  CHAT_SESSION_MANAGER,
  WORKFLOW_REGISTRY,
  WORKFLOW_RUNNER,
} from './contracts';
import { MetricsRegistryService } from './common/metrics-registry.service';
import { HealthCheckService } from './common/health-check.service';
import {
  ChatController,
  WorkflowController,
  ChatService,
  ChatSessionManager,
  InMemoryChatSessionManager,
  TurnStreamFactory,
  UiStreamPresenter,
} from './api';
import { SecurityModule } from './security';

@Module({
  imports: [
    // REDIS_CLIENT và BullMQ inject ConfigService (trước đây host Slack cấp).
    ConfigModule.forRoot({ isGlobal: true, envFilePath: ['.env', '../.env'] }),
    DatabaseModule,
    TypeOrmModule.forFeature([
      OrchestrationCheckpointEntity,
      OrchestrationTriggerClaimEntity,
      DynamicProviderEntity,
      ConversationMemoryEntity,
      SkillEntity,
    ]),
    ScheduleModule.forRoot(),
    CachedModule.forRoot(),
    QueueModule.forRoot(),
    QueueModule.forFeature([
      EQueueName.AI_ORCHESTRATION_QUEUE,
      EQueueName.DYNAMIC_PROVIDER_QUEUE,
    ]),
    SecurityModule,
  ],
  controllers: [ChatController, WorkflowController],
  providers: [
    PrismaChatSessionManager,
    InMemoryChatSessionManager,
    {
      provide: CHAT_SESSION_MANAGER,
      useExisting: PrismaChatSessionManager,
    },
    {
      provide: ChatSessionManager,
      useExisting: CHAT_SESSION_MANAGER,
    },
    TurnStreamFactory,
    ChatService,
    UiStreamPresenter,
    AiOrchestrationProcessor,
    DynamicProviderProcessor,
    ReactLoopService,
    SupervisorService,
    AgentRankingService,
    SupervisorPromptBuilder,
    LlmStrategyFactory,
    GeminiStrategy,
    OpenAiStrategy,
    AnthropicStrategy,
    MockStrategy,
    PrismaCheckpointService,
    {
      provide: CheckpointService,
      useExisting: PrismaCheckpointService,
    },
    CheckpointCleanupService,
    ConversationMemoryService,
    ConversationMemoryCleanupService,
    MemoryManagerService,
    OpenAiEmbeddingProvider,
    SkillService,
    SkillRetrievalService,
    PrismaTriggerClaimService,
    {
      provide: TriggerClaimService,
      useExisting: PrismaTriggerClaimService,
    },
    CircuitBreakerService,
    ProviderConcurrencyLimiterService,
    AgentCancellationService,
    TurnResolverService,
    SubAgentSpawnerService,
    SingleAgentEngine,
    PipelineChainingEngine,
    ParallelFanoutEngine,
    DynamicSupervisorEngine,
    {
      provide: EXECUTION_ENGINE_REGISTRY,
      useFactory: (...engines: IExecutionEngine[]) => {
        const registry = new ExecutionEngineRegistryService();
        engines.forEach((engine) => registry.register(engine));
        return registry;
      },
      inject: [
        SingleAgentEngine,
        PipelineChainingEngine,
        ParallelFanoutEngine,
        DynamicSupervisorEngine,
      ],
    },
    SmartExecutionRouter,
    { provide: EXECUTION_ROUTER, useExisting: SmartExecutionRouter },
    PrismaWorkflowStore,
    WorkflowRegistryService,
    WorkflowRunnerService,
    {
      provide: WORKFLOW_REGISTRY,
      useExisting: PrismaWorkflowStore,
    },
    {
      provide: WORKFLOW_RUNNER,
      useExisting: WorkflowRunnerService,
    },
    CheckpointPauseService,
    ApprovalRequestService,
    ApprovalExecutionService,
    ApprovalContinuationPlannerService,
    ApprovalSkillRecorderService,
    PrismaMessageSink,
    {
      provide: MessageClientService,
      useExisting: PrismaMessageSink,
    },
    AgentStreamService,
    {
      provide: MESSAGE_SINK,
      useExisting: PrismaMessageSink,
    },
    {
      provide: STREAM_SINK,
      useExisting: AgentStreamService,
    },
    MetricsRegistryService,
    HealthCheckService,
    DynamicProviderDbService,
    ProviderSummaryService,
    {
      provide: DYNAMIC_PROVIDER_LOADER,
      useExisting: DynamicProviderDbService,
    },
    {
      provide: CIRCUIT_BREAKER,
      useExisting: CircuitBreakerService,
    },
    {
      provide: PROVIDER_CONCURRENCY_LIMITER,
      useExisting: ProviderConcurrencyLimiterService,
    },
    McpAuthClientService,
    CoreOpenApiParserService,
    CoreDynamicToolRegistryService,
    MockToolConnectorService,
    McpToolConnectorService,
    {
      provide: TOOL_PROVIDER,
      useExisting:
        process.env.MOCK_TOOLS === 'true'
          ? MockToolConnectorService
          : McpToolConnectorService,
    },
    {
      provide: ON_TOKEN_REFRESHED,
      useFactory: (queueService: QueueService) => {
        return (payload: TokenRefreshPayload) => {
          return queueService.addJob(
            EQueueName.DYNAMIC_PROVIDER_QUEUE,
            EJobName.UPDATE_DYNAMIC_PROVIDER_TOKEN,
            payload,
            {
              attempts: 3,
              backoff: { type: 'exponential', delay: 1000 },
              removeOnComplete: true,
            },
          );
        };
      },
      inject: [QueueService],
    },
  ],
  exports: [
    AiOrchestrationProcessor,
    ReactLoopService,
    SupervisorService,
    DynamicProviderDbService,
    ProviderSummaryService,
    LlmStrategyFactory,
    MessageClientService,
    AgentStreamService,
    PrismaChatSessionManager,
    PrismaMessageSink,
    PrismaCheckpointService,
    PrismaTriggerClaimService,
    PrismaWorkflowStore,
    MESSAGE_SINK,
    STREAM_SINK,
    CHAT_SESSION_MANAGER,
    TOOL_PROVIDER,
    McpToolConnectorService,
    McpAuthClientService,
    WorkflowRegistryService,
    WorkflowRunnerService,
    WORKFLOW_REGISTRY,
    WORKFLOW_RUNNER,
    SecurityModule,
  ],
})
export class OrchestrationModule {}
