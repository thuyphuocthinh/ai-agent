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
import { SkillService } from './memory/skill.service';
import { SkillRetrievalService } from './memory/skill-retrieval.service';
import { CheckpointCleanupService } from './engine/hitl/checkpoint-cleanup.service';
import { ResilienceModule } from './infrastructure/resilience/resilience.module';
import { ToolsInfrastructureModule } from './infrastructure/tools/tools-infrastructure.module';
import { EmbeddingModule } from './infrastructure/embedding/embedding.module';
import { AgentCancellationService } from './engine/cancellation/agent-cancellation.service';
import { TurnResolverService } from './engine/orchestrator/turn/turn-resolver.service';
import { ExecutionEngineRegistryService } from './engine/orchestrator/engines/execution-engine-registry.service';
import { SingleAgentEngine } from './engine/orchestrator/engines/single-agent.engine';
import { PipelineChainingEngine } from './engine/orchestrator/engines/pipeline-chaining.engine';
import { ParallelFanoutEngine } from './engine/orchestrator/engines/parallel-fanout.engine';
import { DynamicSupervisorEngine } from './engine/orchestrator/engines/dynamic-supervisor.engine';
import { SubAgentSpawnerService } from './engine/orchestrator/engines/sub-agent-spawner.service';
import { SmartExecutionRouter } from './engine/orchestrator/engines/smart-execution-router.service';
import {
  EXECUTION_ENGINE_REGISTRY,
  EXECUTION_ROUTER,
  IExecutionEngine,
} from './contracts/engine/execution-engine.interface';
import { WorkflowRegistryService } from './engine/workflow/workflow-registry.service';
import { WorkflowRunnerService } from './engine/workflow/workflow-runner.service';
import { CheckpointPauseService } from './engine/hitl/checkpoint-pause.service';
import { ApprovalRequestService } from './engine/hitl/approval-request.service';
import { ApprovalExecutionService } from './engine/hitl/approval-execution.service';
import { ApprovalContinuationPlannerService } from './engine/hitl/approval-continuation-planner.service';
import { ApprovalSkillRecorderService } from './engine/hitl/approval-skill-recorder.service';
import { MessageClientService } from './engine/streaming/message-client.service';
import { AgentStreamService } from './engine/streaming/agent-stream.service';
import {
  MESSAGE_SINK,
  STREAM_SINK,
  CHAT_SESSION_MANAGER,
  WORKFLOW_REGISTRY,
  WORKFLOW_RUNNER,
} from './contracts';
import { HealthCheckService } from './infrastructure/resilience/health-check.service';
import {
  ChatController,
  WorkflowController,
  IntegrationsController,
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
    EmbeddingModule,
    ToolsInfrastructureModule,
  ],
  controllers: [ChatController, WorkflowController, IntegrationsController],
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
    SkillService,
    SkillRetrievalService,
    PrismaTriggerClaimService,
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
    TurnEventRecorderService,
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
    HealthCheckService,
  ],
  exports: [
    AiOrchestrationProcessor,
    ReactLoopService,
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
    WorkflowRunnerService,
    WORKFLOW_REGISTRY,
    WORKFLOW_RUNNER,
    SecurityModule,
  ],
})
export class OrchestrationModule {}
