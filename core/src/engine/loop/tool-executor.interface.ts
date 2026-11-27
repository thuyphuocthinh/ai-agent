import { Logger } from '@nestjs/common';
import { IStreamSink, IToolProvider, IArtifactTmpManager } from '../../contracts';
import { IConversationArtifactStore } from '../../contracts/storage/conversation-artifact.interface';
import { RunReactLoopRequestDto } from '../../contracts/dtos/react-loop.dto';
import { McpToolDto } from '../../contracts/dtos/mcp.dto';
import { MemoryManagerService } from '../../memory/memory-manager.service';
import { ToolRepeatGuard } from './guards/tool-repeat-guard';
import { InsertAccumulator } from './guards/insert-accumulator';
import { ToolRiskGate } from './guards/tool-risk-gate';
import { ActionAuditService } from '../../security';

export interface ToolCallExecutorOptions {
  dto: RunReactLoopRequestDto;
  mcpTools: McpToolDto[];
  reactModelId: string;
  signal: AbortSignal;
  toolToProviderMap?: Map<string, string>;
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
  tmpManager?: IArtifactTmpManager;
  conversationArtifactStore?: IConversationArtifactStore;
}
