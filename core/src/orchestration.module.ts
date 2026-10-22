import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DatabaseModule } from './infrastructure/database/database.module';
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
import { ToolsModule } from '@agent/tools';
import { AgentCancellationService } from './engine/cancellation/agent-cancellation.service';
import { TurnResolverService } from './engine/orchestrator/turn-resolver.service';
import { CheckpointPauseService } from './engine/hitl/checkpoint-pause.service';
import { ApprovalRequestService } from './engine/hitl/approval-request.service';
import { ApprovalExecutionService } from './engine/hitl/approval-execution.service';
import { ApprovalContinuationPlannerService } from './engine/hitl/approval-continuation-planner.service';
import { ApprovalSkillRecorderService } from './engine/hitl/approval-skill-recorder.service';
import { MessageClientService, AgentStreamService } from './contracts';
import { MetricsRegistryService } from './common/metrics-registry.service';
import { HealthCheckService } from './common/health-check.service';
import {
  ChatController,
  ChatService,
  ChatSessionManager,
  TurnStreamFactory,
  UiStreamPresenter,
} from './api';

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
    ToolsModule,
    ScheduleModule.forRoot(),
    CachedModule.forRoot(),
    QueueModule.forRoot(),
    QueueModule.forFeature([
      EQueueName.AI_ORCHESTRATION_QUEUE,
      EQueueName.DYNAMIC_PROVIDER_QUEUE,
    ]),
  ],
  controllers: [ChatController],
  providers: [
    ChatSessionManager,
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
    CheckpointService,
    CheckpointCleanupService,
    ConversationMemoryService,
    ConversationMemoryCleanupService,
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
    ToolsModule,
  ],
})
export class OrchestrationModule {}
