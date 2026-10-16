import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DatabaseModule } from './infrastructure/database/database.module';
import { CachedModule } from './infrastructure/redis/redis.module';
import { QueueModule } from './infrastructure/queue/queue.module';
import { EQueueName } from './infrastructure/queue';
import { AiOrchestrationProcessor } from './orchestrator/ai-orchestration.processor';
import { DynamicProviderProcessor } from './orchestrator/dynamic-provider.processor';
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
import { ToolsModule } from '@agent/tools';
import { AgentCancellationService } from './cancellation/agent-cancellation.service';
import { TurnResolverService } from './orchestrator/turn-resolver.service';
import { CheckpointPauseService } from './hitl/checkpoint-pause.service';
import { ApprovalRequestService } from './hitl/approval-request.service';
import { ApprovalExecutionService } from './hitl/approval-execution.service';
import { ApprovalContinuationPlannerService } from './hitl/approval-continuation-planner.service';
import { ApprovalSkillRecorderService } from './hitl/approval-skill-recorder.service';
import { MessageClientService, AgentStreamService } from './contracts';
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
    ToolsModule,
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
