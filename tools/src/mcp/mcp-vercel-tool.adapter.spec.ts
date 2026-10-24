import { asSchema } from 'ai';
import type { ToolExecutionOptions } from 'ai';
import { McpToolDto } from '../contracts';
import {
  IMcpToolCaller,
  mapMcpToolsToVercel,
} from './mcp-vercel-tool.adapter';

// Dùng `ai@7` THẬT (không mock) — xem ai-esm-smoke.spec.ts và targets AC-1.
describe('mapMcpToolsToVercel (AC-1)', () => {
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

  it('passes the MCP inputSchema through jsonSchema() untouched (no Zod rewrite)', () => {
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

  it('uses ownerId as userId and workspaceId as tenantId when only the legacy fields are given', async () => {
    const tools = mapMcpToolsToVercel(sampleTools, mcpClient, {
      ownerId: 'owner-1',
      workspaceId: 'ws-9',
    });

    await tools.read_query.execute!({ query: 'x' }, options());

    expect(callTool).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'owner-1', tenantId: 'ws-9' }),
      undefined,
    );
  });

  it('sends empty args when the model input is not an object', async () => {
    const tools = mapMcpToolsToVercel(sampleTools, mcpClient);

    await tools.read_query.execute!(null as never, options());
    await tools.read_query.execute!(['a'] as never, options());

    expect(callTool.mock.calls[0][0].args).toEqual({});
    expect(callTool.mock.calls[1][0].args).toEqual({});
  });

  it('joins the text parts of the MCP result', async () => {
    callTool.mockResolvedValue({
      content: [
        { type: 'text', text: 'dòng 1' },
        { type: 'image' },
        { type: 'text', text: 'dòng 2' },
      ],
    });
    const tools = mapMcpToolsToVercel(sampleTools, mcpClient);

    await expect(
      tools.read_query.execute!({ query: 'x' }, options()),
    ).resolves.toBe('dòng 1\ndòng 2');
  });

  it('serializes non-text content instead of returning an empty string', async () => {
    callTool.mockResolvedValue({ content: [{ type: 'image' }] });
    const tools = mapMcpToolsToVercel(sampleTools, mcpClient);

    await expect(
      tools.read_query.execute!({ query: 'x' }, options()),
    ).resolves.toBe('[{"type":"image"}]');
  });

  it('throws when the MCP tool reports isError, so the SDK records a tool error', async () => {
    callTool.mockResolvedValue({
      isError: true,
      content: [{ type: 'text', text: 'Invalid object name' }],
    });
    const tools = mapMcpToolsToVercel(sampleTools, mcpClient);

    await expect(
      tools.read_query.execute!({ query: 'x' }, options()),
    ).rejects.toThrow('Invalid object name');
  });

  it('propagates transport failures from callTool', async () => {
    callTool.mockRejectedValue(new Error('ECONNRESET'));
    const tools = mapMcpToolsToVercel(sampleTools, mcpClient);

    await expect(
      tools.read_query.execute!({ query: 'x' }, options()),
    ).rejects.toThrow('ECONNRESET');
  });

  it('skips entries without a name and tolerates non-array input', () => {
    const tools = mapMcpToolsToVercel(
      [{ description: 'no name' } as unknown as McpToolDto, ...sampleTools],
      mcpClient,
    );

    expect(Object.keys(tools)).toEqual(['read_query', 'table_schema']);
    expect(mapMcpToolsToVercel([], mcpClient)).toEqual({});
    expect(
      mapMcpToolsToVercel(null as unknown as McpToolDto[], mcpClient),
    ).toEqual({});
  });
});
