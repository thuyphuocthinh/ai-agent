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
});
