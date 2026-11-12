import { Injectable, Logger, Optional, Inject } from '@nestjs/common';
import { INativeTool, NativeToolExecutionContext } from './native-tool.interface';
import {
  CallToolRequestDto,
  CallToolResponseDto,
  McpToolDto,
} from '../../../contracts/dtos/mcp.dto';
import { ToolContext } from '../../../contracts/tools/tool-provider.interface';
import { nativeToolError } from './native-tool-response.util';

@Injectable()
export class NativeToolRegistryService {
  private readonly logger = new Logger(NativeToolRegistryService.name);
  private readonly tools = new Map<string, INativeTool>();

  constructor(
    @Optional()
    @Inject('NATIVE_TOOLS_LIST')
    nativeTools?: INativeTool[],
  ) {
    if (nativeTools && Array.isArray(nativeTools)) {
      for (const tool of nativeTools) {
        this.registerTool(tool);
      }
    }
  }

  registerTool(tool: INativeTool): void {
    if (this.tools.has(tool.name)) {
      this.logger.warn(`Overwriting native tool "${tool.name}"`);
    }
    this.tools.set(tool.name, tool);
    this.logger.log(`Registered native tool: ${tool.name}`);
  }

  hasTool(toolName: string): boolean {
    return this.tools.has(toolName);
  }

  getTool(toolName: string): INativeTool | undefined {
    return this.tools.get(toolName);
  }

  getAllTools(): McpToolDto[] {
    return Array.from(this.tools.values()).map((t) => t.toMcpToolDto());
  }

  async executeTool(
    toolName: string,
    args: Record<string, unknown>,
    context?: NativeToolExecutionContext,
  ): Promise<CallToolResponseDto> {
    const tool = this.tools.get(toolName);
    if (!tool) {
      return nativeToolError(
        'NATIVE_TOOL_NOT_FOUND',
        `Native tool "${toolName}" was not found`,
      );
    }

    try {
      return await tool.execute(args, context);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Error executing native tool "${toolName}": ${message}`);
      return nativeToolError('NATIVE_TOOL_EXECUTION_ERROR', message);
    }
  }

  // Chạy native tool từ một yêu cầu gọi tool của engine: gộp danh tính từ `context`
  // (ưu tiên) và `dto`. Dùng chung cho mọi tool connector (MCP, mock).
  executeFromRequest(
    dto: CallToolRequestDto,
    context?: ToolContext,
    signal?: AbortSignal,
  ): Promise<CallToolResponseDto> {
    const userId = context?.userId ?? dto.userId;
    return this.executeTool(dto.name, dto.args ?? {}, {
      userId,
      ownerId: userId ?? dto.ownerId,
      workspaceId: context?.workspaceId ?? dto.workspaceId,
      tenantId: context?.tenantId ?? dto.tenantId,
      messageId: context?.messageId ?? dto.messageId,
      signal: signal ?? context?.signal,
    });
  }
}
