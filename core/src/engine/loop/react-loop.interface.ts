import { Logger } from '@nestjs/common';
import { IStreamSink, IToolProvider } from '../../contracts';
import { RunReactLoopRequestDto } from '../../contracts/dtos/react-loop.dto';
import { McpToolDto } from '../../contracts/dtos/mcp.dto';
import { LlmChatSession, LlmStrategy } from '../strategy/llm-strategy.interface';
import { CircuitBreakerService } from '../../common/circuit-breaker.service';
import { MemoryManagerService } from '../../memory/memory-manager.service';
import { ToolRepeatGuard } from './tool-repeat-guard';

export interface ReactLoopRunOptions {
  dto: RunReactLoopRequestDto;
  mcpTools: McpToolDto[];
  strategy: LlmStrategy;
  model: string;
  reactModelId: string;
  session: LlmChatSession;
  signal: AbortSignal;
  repeatGuard?: ToolRepeatGuard;
}

export interface ReactLoopRunDeps {
  toolProvider?: IToolProvider;
  mcpClient?: IToolProvider;
  streamSink?: IStreamSink;
  agentStream?: IStreamSink;
  circuitBreaker: CircuitBreakerService;
  memoryManager: MemoryManagerService;
  logger: Logger;
}
