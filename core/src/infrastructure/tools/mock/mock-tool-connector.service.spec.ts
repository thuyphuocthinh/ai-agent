import { MockToolConnectorService } from './mock-tool-connector.service';
import { NativeToolRegistryService } from '../native/native-tool-registry.service';
import { INativeTool } from '../native/native-tool.interface';
import { IArtifactTmpManager } from '../../../contracts/storage/artifact-tmp.interface';

describe('MockToolConnectorService — native tools', () => {
  const executeSpy = jest.fn();
  const nativeTool: INativeTool = {
    name: 'read_skill',
    description: 'đọc skill',
    inputSchema: { type: 'object' },
    toMcpToolDto() {
      return { name: this.name, description: this.description, inputSchema: this.inputSchema };
    },
    async execute(args, context) {
      executeSpy(args, context);
      return { isError: false, content: [{ type: 'text', text: 'playbook' }] };
    },
  };

  afterEach(() => jest.clearAllMocks());

  it('lists the registry tools for the "native" provider', async () => {
    const connector = new MockToolConnectorService(
      new NativeToolRegistryService([nativeTool]),
    );

    const tools = await connector.getTools('native');

    expect(tools.map((t) => t.name)).toEqual(['read_skill']);
  });

  it('returns no native tools when no registry is available', async () => {
    const connector = new MockToolConnectorService();

    await expect(connector.getTools('native')).resolves.toEqual([]);
  });

  it('executes a native tool by name and forwards the tenant context', async () => {
    const connector = new MockToolConnectorService(
      new NativeToolRegistryService([nativeTool]),
    );

    const res = await connector.callTool(
      { name: 'read_skill', args: { slug: 'a' }, provider: 'native' },
      undefined,
      { workspaceId: 'ws-1' },
    );

    expect(res.content?.[0]?.text).toBe('playbook');
    expect(executeSpy).toHaveBeenCalledWith(
      { slug: 'a' },
      expect.objectContaining({ workspaceId: 'ws-1' }),
    );
  });

  it('still serves the regular mock providers', async () => {
    const connector = new MockToolConnectorService(
      new NativeToolRegistryService([nativeTool]),
    );

    const tools = await connector.getTools('sql_server');

    expect(tools.length).toBeGreaterThan(0);
  });

  it('configures compute provider with tmpManager and forwards context', async () => {
    const mockTmpManager: jest.Mocked<IArtifactTmpManager> = {
      getBaseDir: jest.fn().mockReturnValue('/tmp'),
      getTurnDir: jest.fn().mockReturnValue('/tmp/ws-turn-42'),
      saveJsonToFile: jest.fn(),
      readJsonFromFile: jest.fn(),
      cleanTurnDir: jest.fn(),
      cleanExpiredDirs: jest.fn(),
    };

    const connector = new MockToolConnectorService(undefined, mockTmpManager);
    const tools = await connector.getTools('compute');
    expect(tools.map((t) => t.name)).toContain('run_python');
  });

  it('serves orders_large with >50KB payload triggering direct-to-disk capability', async () => {
    const connector = new MockToolConnectorService();
    const result = await connector.callTool({
      name: 'read_query',
      args: { query: 'SELECT * FROM orders_large' },
      provider: 'sql_server',
    });
    expect(result.isError).toBe(false);
    const text = result.content?.[0]?.text ?? '';
    expect(text.length).toBeGreaterThan(50_000);
  });
});
