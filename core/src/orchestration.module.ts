import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { DatabaseModule } from './infrastructure/database/database.module';
import {
  PrismaChatSessionManager,
  PrismaMessageSink,
  PrismaCheckpointService,
  PrismaTriggerClaimService,
  PrismaWorkflowStore,
} from './infrastructure/database';
import { CachedModule } from './infrastructure/redis/redis.module';
import { TurnEventRecorderService } from './engine/orchestrator/turn/turn-event-recorder.service';
import { QueueModule } from './infrastructure/queue/queue.module';
import { EQueueName } from './infrastructure/queue';
import { AiOrchestrationProcessor } from './engine/orchestrator/processors/ai-orchestration.processor';
import { DynamicProviderProcessor } from './engine/orchestrator/processors/dynamic-provider.processor';
import { ReactLoopService } from './engine/loop/react-loop.service';
import { AgentDiscoveryService } from './engine/discovery/agent-discovery.service';
import { SupervisorService } from './engine/supervisor/supervisor.service';
import { AgentRankingService } from './engine/supervisor/agent-ranking.service';
import { SupervisorPromptBuilder } from './engine/supervisor/supervisor-prompt.builder';
import { LlmStrategyFactory } from './engine/strategy/llm-strategy.factory';
import { GeminiStrategy } from './engine/strategy/gemini/gemini.strategy';
import { OpenAiStrategy } from './engine/strategy/openai/openai.strategy';
import { AnthropicStrategy } from './engine/strategy/anthropic/anthropic.strategy';
import { MockStrategy } from './engine/strategy/mock/mock.strategy';
import { ConversationMemoryService } from './memory/conversation-memory.service';
import { CONVERSATION_MEMORY_RECORDER } from './contracts/memory/conversation-memory-recorder.interface';
import {
  QUEUE_PROCESSORS,
  TQueueProcessorMap,
} from './contracts/queue/queue-processor.interface';
import { ConversationMemoryCleanupService } from './memory/conversation-memory-cleanup.service';
import { MemoryManagerService } from './memory/memory-manager.service';
import { SkillCatalogService } from './memory/skill/skill-catalog.service';
import { SKILL_CATALOG_READER } from './contracts/skill/skill-catalog-reader.interface';
import { SKILL_MATCHER } from './contracts/skill/skill-matcher.interface';
import { SkillMatchService } from './memory/skill/skill-match.service';
import { ReadSkillTool } from './infrastructure/tools/native/read-skill.tool';
import { GoogleSheetsStructureTool } from './infrastructure/tools/native/google-sheets-structure.tool';
import { GoogleSheetsBatchUpdateTool } from './infrastructure/tools/native/google-sheets-batch-update.tool';
import { CheckpointCleanupService } from './engine/hitl/checkpoint-cleanup.service';
import { ResilienceModule } from './infrastructure/resilience/resilience.module';
import { ToolsInfrastructureModule } from './infrastructure/tools/tools-infrastructure.module';
import { StorageModule } from './infrastructure/storage';
import { ObservabilityModule } from './infrastructure/observability/observability.module';
import { EmbeddingModule } from './infrastructure/embedding/embedding.module';
import { AgentCancellationService } from './engine/cancellation/agent-cancellation.service';
import { TurnResolverService } from './engine/orchestrator/turn/turn-resolver.service';
import { ExecutionEngineRegistryService } from './engine/orchestrator/engines/execution-engine-registry.service';
import { DeterministicSingleRunner } from './engine/orchestrator/engines/deterministic/deterministic-single.runner';
import { DeterministicSequenceRunner } from './engine/orchestrator/engines/deterministic/deterministic-sequence.runner';
import { DeterministicParallelRunner } from './engine/orchestrator/engines/deterministic/deterministic-parallel.runner';
import { DeterministicEngine } from './engine/orchestrator/engines/deterministic.engine';
import { AutonomousEngine } from './engine/orchestrator/engines/autonomous.engine';
import { SubAgentSpawnerService } from './engine/orchestrator/engines/sub-agent-spawner.service';
import { SmartExecutionRouter } from './engine/orchestrator/engines/smart-execution-router.service';
import {
  EXECUTION_ENGINE_REGISTRY,
  EXECUTION_ROUTER,
  IExecutionEngine,
} from './contracts/engine/execution-engine.interface';
import { WorkflowRegistryService } from './engine/workflow/workflow-registry.service';
import { CheckpointPauseService } from './engine/hitl/checkpoint-pause.service';
import { ApprovalRequestService } from './engine/hitl/approval-request.service';
import { ApprovalExecutionService } from './engine/hitl/approval-execution.service';
import { ApprovalContinuationPlannerService } from './engine/hitl/approval-continuation-planner.service';
import { MessageClientService } from './engine/streaming/message-client.service';
import { AgentStreamService } from './engine/streaming/agent-stream.service';
import {
  MESSAGE_SINK,
  STREAM_SINK,
  CHAT_SESSION_MANAGER,
  WORKFLOW_REGISTRY,
} from './contracts';
import { HealthCheckService } from './infrastructure/resilience/health-check.service';
import {
  ChatController,
  WorkflowController,
  IntegrationsController,
  SkillController,
  MetricsController,
  HealthController,
  ChatService,
  IntegrationsService,
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
    ScheduleModule.forRoot(),
    CachedModule.forRoot(),
    QueueModule.forRoot(),
    QueueModule.forFeature([
      EQueueName.AI_ORCHESTRATION_QUEUE,
      EQueueName.DYNAMIC_PROVIDER_QUEUE,
    ]),
    SecurityModule,
    ResilienceModule,
    ObservabilityModule,
    EmbeddingModule,
    ToolsInfrastructureModule,
    StorageModule,
  ],
  controllers: [
    ChatController,
    WorkflowController,
    IntegrationsController,
    SkillController,
    MetricsController,
    HealthController,
  ],
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
    IntegrationsService,
    UiStreamPresenter,
    AiOrchestrationProcessor,
    DynamicProviderProcessor,
    {
      provide: QUEUE_PROCESSORS,
      useFactory: (
        aiOrchestration: AiOrchestrationProcessor,
        dynamicProvider: DynamicProviderProcessor,
      ): TQueueProcessorMap => ({
        [EQueueName.AI_ORCHESTRATION_QUEUE]: aiOrchestration,
        [EQueueName.DYNAMIC_PROVIDER_QUEUE]: dynamicProvider,
      }),
      inject: [AiOrchestrationProcessor, DynamicProviderProcessor],
    },
    ReactLoopService,
    AgentDiscoveryService,
    SupervisorService,
    AgentRankingService,
    SupervisorPromptBuilder,
    LlmStrategyFactory,
    GeminiStrategy,
    OpenAiStrategy,
    AnthropicStrategy,
    MockStrategy,
    PrismaCheckpointService,
    CheckpointCleanupService,
    ConversationMemoryService,
    {
      provide: CONVERSATION_MEMORY_RECORDER,
      useExisting: ConversationMemoryService,
    },
    ConversationMemoryCleanupService,
    MemoryManagerService,
    SkillCatalogService,
    { provide: SKILL_CATALOG_READER, useExisting: SkillCatalogService },
    SkillMatchService,
    { provide: SKILL_MATCHER, useExisting: SkillMatchService },
    ReadSkillTool,
    GoogleSheetsStructureTool,
    GoogleSheetsBatchUpdateTool,
    PrismaTriggerClaimService,
    AgentCancellationService,
    TurnResolverService,
    SubAgentSpawnerService,
    DeterministicSingleRunner,
    DeterministicSequenceRunner,
    DeterministicParallelRunner,
    DeterministicEngine,
    AutonomousEngine,
    {
      provide: EXECUTION_ENGINE_REGISTRY,
      useFactory: (...engines: IExecutionEngine[]) => {
        const registry = new ExecutionEngineRegistryService();
        engines.forEach((engine) => registry.register(engine));
        return registry;
      },
      inject: [
        DeterministicEngine,
        AutonomousEngine,
      ],
    },
    SmartExecutionRouter,
    { provide: EXECUTION_ROUTER, useExisting: SmartExecutionRouter },
    PrismaWorkflowStore,
    WorkflowRegistryService,
    {
      provide: WORKFLOW_REGISTRY,
      useExisting: PrismaWorkflowStore,
    },
    CheckpointPauseService,
    TurnEventRecorderService,
    ApprovalRequestService,
    ApprovalExecutionService,
    ApprovalContinuationPlannerService,
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
    HealthCheckService,
  ],
  exports: [
    AiOrchestrationProcessor,
    ReactLoopService,
    AgentDiscoveryService,
    SupervisorService,
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
    ToolsInfrastructureModule,
    WorkflowRegistryService,
    DeterministicSingleRunner,
    DeterministicSequenceRunner,
    DeterministicParallelRunner,
    DeterministicEngine,
    AutonomousEngine,
    WORKFLOW_REGISTRY,
    SecurityModule,
  ],
})
export class OrchestrationModule {}
