import { CallToolResponseDto, McpToolDto } from '../../../contracts/dtos/mcp.dto';

export interface NativeToolExecutionContext {
  userId?: string;
  ownerId?: string;
  workspaceId?: string;
  tenantId?: string;
  messageId?: string;
  signal?: AbortSignal;
}

export interface INativeTool {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;

  toMcpToolDto(): McpToolDto;

  execute(
    args: Record<string, unknown>,
    context?: NativeToolExecutionContext,
  ): Promise<CallToolResponseDto>;
}

export const NATIVE_TOOL = Symbol.for('NATIVE_TOOL');
export const NATIVE_TOOL_REGISTRY = Symbol.for('NATIVE_TOOL_REGISTRY');
