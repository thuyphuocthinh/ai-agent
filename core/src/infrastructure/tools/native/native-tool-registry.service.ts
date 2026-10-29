import { Injectable, Logger, Optional, Inject } from '@nestjs/common';
import { INativeTool, NativeToolExecutionContext } from './native-tool.interface';
import { CallToolResponseDto, McpToolDto } from '../../../contracts/dtos/mcp.dto';

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
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              error: true,
              retryable: false,
              code: 'NATIVE_TOOL_NOT_FOUND',
              message: `Native tool "${toolName}" was not found`,
            }),
          },
        ],
      };
    }

    try {
      return await tool.execute(args, context);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Error executing native tool "${toolName}": ${message}`);
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              error: true,
              retryable: false,
              code: 'NATIVE_TOOL_EXECUTION_ERROR',
              message,
            }),
          },
        ],
      };
    }
  }
}
