import { Logger } from '@nestjs/common';
import { IStreamSink, IToolProvider } from '../../contracts';
import { RunReactLoopRequestDto } from '../../contracts/dtos/react-loop.dto';
import { McpToolDto } from '../../contracts/dtos/mcp.dto';
import { LlmStrategy } from '../strategy/llm-strategy.interface';
import { CircuitBreakerService } from '../../common/circuit-breaker.service';
import { MemoryManagerService } from '../../memory/memory-manager.service';
import { ToolRepeatGuard } from './tool-repeat-guard';
import { InsertAccumulator } from './insert-accumulator';
import { ToolRiskGate } from './tool-risk-gate';
import {
  ProviderPreflightGuard,
  BusinessPolicyEngine,
  SemanticPolicyEvaluatorService,
  IdempotencyManager,
  ActionAuditService,
} from '../../security';

export interface ToolCallExecutorOptions {
  dto: RunReactLoopRequestDto;
  mcpTools: McpToolDto[];
  reactModelId: string;
  signal: AbortSignal;
}

export interface ToolCallExecutorDeps {
  toolProvider?: IToolProvider;
  mcpClient?: IToolProvider;
  streamSink?: IStreamSink;
  agentStream?: IStreamSink;
  memoryManager: MemoryManagerService;
  logger: Logger;
  repeatGuard: ToolRepeatGuard;
  insertAccumulator: InsertAccumulator;
  riskGate: ToolRiskGate;
  actionAudit?: ActionAuditService;
}

export interface ToolRiskGateOptions {
  dto: RunReactLoopRequestDto;
  mcpTools: McpToolDto[];
  strategy: LlmStrategy;
  model: string;
  circuitBreaker: CircuitBreakerService;
  logger: Logger;
  signal: AbortSignal;
  insertAccumulator: InsertAccumulator;
  preflightGuard?: ProviderPreflightGuard;
  policyEngine?: BusinessPolicyEngine;
  semanticPolicyEvaluator?: SemanticPolicyEvaluatorService;
  idempotencyManager?: IdempotencyManager;
}
