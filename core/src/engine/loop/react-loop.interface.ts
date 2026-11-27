import { Logger } from '@nestjs/common';
import { IStreamSink, IToolProvider, IArtifactTmpManager } from '../../contracts';
import { IConversationArtifactStore } from '../../contracts/storage/conversation-artifact.interface';
import { RunReactLoopRequestDto } from '../../contracts/dtos/react-loop.dto';
import { McpToolDto } from '../../contracts/dtos/mcp.dto';
import { LlmChatSession, LlmStrategy } from '../../contracts/engine/llm-strategy.interface';
import { CircuitBreakerService } from '../../infrastructure/resilience/circuit-breaker.service';
import { MemoryManagerService } from '../../memory/memory-manager.service';
import { ToolRepeatGuard } from './guards/tool-repeat-guard';
import {
  ProviderPreflightGuard,
  BusinessPolicyEngine,
  SemanticPolicyEvaluatorService,
  IdempotencyManager,
  ActionAuditService,
} from '../../security';

export interface ReactLoopRunOptions {
  dto: RunReactLoopRequestDto;
  mcpTools: McpToolDto[];
  strategy: LlmStrategy;
  model: string;
  reactModelId: string;
  session: LlmChatSession;
  signal: AbortSignal;
  repeatGuard?: ToolRepeatGuard;
  toolToProviderMap?: Map<string, string>;
}

export interface ReactLoopRunDeps {
  toolProvider?: IToolProvider;
  mcpClient?: IToolProvider;
  streamSink?: IStreamSink;
  agentStream?: IStreamSink;
  circuitBreaker: CircuitBreakerService;
  memoryManager: MemoryManagerService;
  logger: Logger;
  preflightGuard?: ProviderPreflightGuard;
  policyEngine?: BusinessPolicyEngine;
  semanticPolicyEvaluator?: SemanticPolicyEvaluatorService;
  idempotencyManager?: IdempotencyManager;
  actionAudit?: ActionAuditService;
  tmpManager?: IArtifactTmpManager;
  conversationArtifactStore?: IConversationArtifactStore;
}
