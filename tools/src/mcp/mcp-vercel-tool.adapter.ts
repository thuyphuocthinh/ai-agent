import { tool, jsonSchema } from 'ai';
import type { ToolSet } from 'ai';
import {
  CallToolRequestDto,
  CallToolResponseDto,
  McpToolDto,
} from '../contracts';
import { extractTextFromMcpResult } from '../common/tool-utils';

/** Phần của McpClientService mà adapter cần — tách ra để test không phải dựng cả client. */
export interface IMcpToolCaller {
  callTool(
    dto: CallToolRequestDto,
    signal?: AbortSignal,
  ): Promise<CallToolResponseDto>;
}

/** Danh tính/định tuyến gắn vào mọi lần gọi tool (cùng ý nghĩa với CallToolRequestDto). */
export interface VercelToolAdapterContext {
  provider?: string;
  ownerId?: string;
  userId?: string;
  workspaceId?: string;
  tenantId?: string;
}

const EMPTY_OBJECT_SCHEMA = { type: 'object', properties: {} };

type JsonSchemaInput = Parameters<typeof jsonSchema>[0];

function toToolArguments(input: unknown): Record<string, unknown> {
  return input && typeof input === 'object' && !Array.isArray(input)
    ? (input as Record<string, unknown>)
    : {};
}

/**
 * MCP tool trả lỗi qua `isError` thay vì throw (xem CallToolResponseDto). Với
 * Vercel AI SDK, tool lỗi PHẢI throw để SDK ghi nhận là lỗi (tool-output-error)
 * chứ không phải kết quả thành công.
 */
function toToolOutput(toolName: string, result: CallToolResponseDto): string {
  const text = extractTextFromMcpResult(result);
  if (result.isError) {
    throw new Error(text || `MCP tool "${toolName}" returned an error`);
  }
  return text || JSON.stringify(result.content ?? []);
}

/**
 * Chuyển danh sách MCP tool thành ToolSet của Vercel AI SDK (`ai@7`): schema
 * MCP đi thẳng qua `jsonSchema()` (không viết lại Zod) và `execute` chuyển tiếp
 * vào `mcpClient.callTool()`, kèm abortSignal để huỷ được giữa chừng.
 */
export function mapMcpToolsToVercel(
  mcpTools: McpToolDto[],
  mcpClient: IMcpToolCaller,
  context: VercelToolAdapterContext = {},
): ToolSet {
  const tools: ToolSet = {};
  if (!Array.isArray(mcpTools)) return tools;

  for (const mcpTool of mcpTools) {
    if (!mcpTool?.name) continue;

    const schema =
      mcpTool.inputSchema && typeof mcpTool.inputSchema === 'object'
        ? mcpTool.inputSchema
        : EMPTY_OBJECT_SCHEMA;

    tools[mcpTool.name] = tool<
      Record<string, unknown>,
      string,
      Record<string, unknown>
    >({
      description: mcpTool.description ?? '',
      inputSchema: jsonSchema<Record<string, unknown>>(
        schema as JsonSchemaInput,
      ),
      execute: async (input, { abortSignal }) => {
        const result = await mcpClient.callTool(
          {
            name: mcpTool.name,
            args: toToolArguments(input),
            provider: context.provider,
            ownerId: context.ownerId,
            userId: context.userId ?? context.ownerId,
            workspaceId: context.workspaceId,
            tenantId: context.tenantId ?? context.workspaceId,
          },
          abortSignal,
        );
        return toToolOutput(mcpTool.name, result);
      },
    });
  }

  return tools;
}
