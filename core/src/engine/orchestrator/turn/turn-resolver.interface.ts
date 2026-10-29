import { Logger } from '@nestjs/common';
import { IProcessAiTriggerJobData } from '@agent/core/infrastructure/queue';
import { ReactLoopService } from '../../loop/react-loop.service';
import { SupervisorService } from '../../supervisor/supervisor.service';
import { IStreamSink } from '../../../contracts';
import {
  AvailableAgentDto,
  SupervisorRoundDto,
} from '../../../contracts/dtos/supervisor.dto';
import { ToolCallTraceDto } from '../../../contracts/dtos/react-loop.dto';
import { ChatHistoryTurnDto } from '../../../contracts/dtos/message-client.dto';
import { AgentCancellationService } from '../../cancellation/agent-cancellation.service';
import { CheckpointPauseService } from '../../hitl/checkpoint-pause.service';
import { MetricsRegistryService } from '../../../infrastructure/resilience/metrics-registry.service';
import { MemoryManagerService } from '../../../memory/memory-manager.service';

export interface TurnResolverRunOptions {
  data: IProcessAiTriggerJobData;
  replyMessageId: string;
  prompt: string;
  agents: AvailableAgentDto[];
  history: ChatHistoryTurnDto[];
  rounds: SupervisorRoundDto[];
  toolCalls: ToolCallTraceDto[];
  signal?: AbortSignal;
}

export interface TurnResolverRunDeps {
  reactLoop: ReactLoopService;
  supervisor: SupervisorService;
  streamSink?: IStreamSink;
  agentStream?: IStreamSink;
  cancellation: AgentCancellationService;
  checkpointPause: CheckpointPauseService;
  metrics: MetricsRegistryService;
  memoryManager: MemoryManagerService;
  logger: Logger;
}
