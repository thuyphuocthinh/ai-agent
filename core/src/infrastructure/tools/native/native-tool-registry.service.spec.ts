import { NativeToolRegistryService } from './native-tool-registry.service';
import { INativeTool, NativeToolExecutionContext } from './native-tool.interface';
import { CallToolResponseDto, McpToolDto } from '../../../contracts/dtos/mcp.dto';

describe('NativeToolRegistryService', () => {
  let registry: NativeToolRegistryService;

  const sampleTool: INativeTool = {
    name: 'custom_db_query',
    description: 'Query custom database',
    inputSchema: { type: 'object', properties: { query: { type: 'string' } } },
    toMcpToolDto(): McpToolDto {
      return {
        name: this.name,
        description: this.description,
        inputSchema: this.inputSchema,
      };
    },
    async execute(
      args: Record<string, unknown>,
      _context?: NativeToolExecutionContext,
    ): Promise<CallToolResponseDto> {
      return {
        isError: false,
        content: [{ type: 'text', text: `Result for ${String(args.query)}` }],
      };
    },
  };

  beforeEach(() => {
    registry = new NativeToolRegistryService([sampleTool]);
  });

  it('should register tool from constructor list and check presence', () => {
    expect(registry.hasTool('custom_db_query')).toBe(true);
    expect(registry.hasTool('other_tool')).toBe(false);
    expect(registry.getAllTools()).toHaveLength(1);
    expect(registry.getAllTools()[0].name).toBe('custom_db_query');
  });

  it('should execute tool successfully', async () => {
    const res = await registry.executeTool('custom_db_query', { query: 'SELECT 1' });
    expect(res.isError).toBe(false);
    expect(res.content[0].text).toBe('Result for SELECT 1');
  });

  it('should return error if tool not found', async () => {
    const res = await registry.executeTool('not_found', {});
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain('NATIVE_TOOL_NOT_FOUND');
  });

  it('should handle tool execution exception gracefully', async () => {
    const failingTool: INativeTool = {
      name: 'failing_tool',
      description: 'Will fail',
      inputSchema: {},
      toMcpToolDto(): McpToolDto {
        return { name: this.name, description: this.description, inputSchema: this.inputSchema };
      },
      async execute(): Promise<CallToolResponseDto> {
        throw new Error('Connection refused to customer DB');
      },
    };

    registry.registerTool(failingTool);
    const res = await registry.executeTool('failing_tool', {});
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain('NATIVE_TOOL_EXECUTION_ERROR');
    expect(res.content[0].text).toContain('Connection refused to customer DB');
  });

  describe('executeFromRequest', () => {
    const executeSpy = jest.fn();
    const spyTool: INativeTool = {
      name: 'spy_tool',
      description: 'spy',
      inputSchema: {},
      toMcpToolDto() {
        return { name: this.name, description: this.description, inputSchema: this.inputSchema };
      },
      async execute(args, context) {
        executeSpy(args, context);
        return { isError: false, content: [{ type: 'text', text: 'ok' }] };
      },
    };

    beforeEach(() => {
      registry = new NativeToolRegistryService([spyTool]);
      executeSpy.mockClear();
    });

    it('prefers the identity of the tool context over the one in the request', async () => {
      await registry.executeFromRequest(
        { name: 'spy_tool', args: { a: 1 }, userId: 'req-user', workspaceId: 'req-ws', tenantId: 'req-tenant' },
        { userId: 'ctx-user', workspaceId: 'ctx-ws', tenantId: 'ctx-tenant' },
      );

      expect(executeSpy).toHaveBeenCalledWith(
        { a: 1 },
        expect.objectContaining({
          userId: 'ctx-user',
          ownerId: 'ctx-user',
          workspaceId: 'ctx-ws',
          tenantId: 'ctx-tenant',
        }),
      );
    });

    it('falls back to the identity in the request and to ownerId when there is no user', async () => {
      await registry.executeFromRequest({
        name: 'spy_tool',
        args: {},
        ownerId: 'owner-1',
        workspaceId: 'req-ws',
      });

      expect(executeSpy).toHaveBeenCalledWith(
        {},
        expect.objectContaining({ ownerId: 'owner-1', workspaceId: 'req-ws' }),
      );
    });

    it('passes the explicit signal, else the signal of the context', async () => {
      const explicit = new AbortController().signal;
      const fromContext = new AbortController().signal;

      await registry.executeFromRequest({ name: 'spy_tool', args: {} }, { signal: fromContext }, explicit);
      await registry.executeFromRequest({ name: 'spy_tool', args: {} }, { signal: fromContext });

      expect(executeSpy.mock.calls[0][1].signal).toBe(explicit);
      expect(executeSpy.mock.calls[1][1].signal).toBe(fromContext);
    });

    it('defaults the arguments to an empty object', async () => {
      await registry.executeFromRequest({ name: 'spy_tool' } as never);

      expect(executeSpy.mock.calls[0][0]).toEqual({});
    });
  });
});
