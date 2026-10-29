import { asSchema } from 'ai';
import type { ToolExecutionOptions } from 'ai';
import { McpToolDto } from '../../../../contracts/dtos/mcp.dto';
import {
  IMcpToolCaller,
  mapMcpToolsToVercel,
} from './mcp-vercel-tool.adapter';

describe('mapMcpToolsToVercel', () => {
  const readQuerySchema = {
    type: 'object',
    properties: { query: { type: 'string' } },
    required: ['query'],
  };
  const sampleTools: McpToolDto[] = [
    { name: 'read_query', description: 'Run a read-only SQL', inputSchema: readQuerySchema },
    { name: 'table_schema', inputSchema: { type: 'object', properties: {} } },
  ];

  const callTool = jest.fn();
  const mcpClient: IMcpToolCaller = { callTool };

  const options = (
    overrides: Partial<ToolExecutionOptions<Record<string, unknown>>> = {},
  ): ToolExecutionOptions<Record<string, unknown>> => ({
    toolCallId: 'call-1',
    messages: [],
    context: {},
    ...overrides,
  });

  beforeEach(() => {
    callTool.mockReset();
    callTool.mockResolvedValue({ content: [{ type: 'text', text: 'ok' }] });
  });

  it('returns one Vercel tool per MCP tool, keyed by name', () => {
    const tools = mapMcpToolsToVercel(sampleTools, mcpClient);

    expect(Object.keys(tools)).toEqual(['read_query', 'table_schema']);
    expect(tools.read_query.description).toBe('Run a read-only SQL');
    expect(tools.table_schema.description).toBe('');
  });

  it('passes the MCP inputSchema through jsonSchema() untouched', () => {
    const tools = mapMcpToolsToVercel(sampleTools, mcpClient);

    expect(asSchema(tools.read_query.inputSchema).jsonSchema).toEqual(
      readQuerySchema,
    );
  });

  it('falls back to an empty object schema when the MCP schema is missing', () => {
    const tools = mapMcpToolsToVercel(
      [{ name: 'ping' } as unknown as McpToolDto],
      mcpClient,
    );

    expect(asSchema(tools.ping.inputSchema).jsonSchema).toEqual({
      type: 'object',
      properties: {},
    });
  });

  it('delegates execute() to mcpClient.callTool with args, context and abortSignal', async () => {
    const tools = mapMcpToolsToVercel(sampleTools, mcpClient, {
      provider: 'sql_server',
      userId: 'user-1',
      workspaceId: 'ws-1',
    });
    const controller = new AbortController();

    const output = await tools.read_query.execute!(
      { query: 'SELECT 1' },
      options({ abortSignal: controller.signal }),
    );

    expect(callTool).toHaveBeenCalledWith(
      {
        name: 'read_query',
        args: { query: 'SELECT 1' },
        provider: 'sql_server',
        ownerId: undefined,
        userId: 'user-1',
        workspaceId: 'ws-1',
        tenantId: 'ws-1',
      },
      controller.signal,
    );
    expect(output).toBe('ok');
  });

  it('throws Error when MCP result isError is true', async () => {
    callTool.mockResolvedValue({
      isError: true,
      content: [{ type: 'text', text: 'Database error' }],
    });

    const tools = mapMcpToolsToVercel(sampleTools, mcpClient);

    await expect(
      tools.read_query.execute!({ query: 'FAIL' }, options()),
    ).rejects.toThrow('Database error');
  });
});
