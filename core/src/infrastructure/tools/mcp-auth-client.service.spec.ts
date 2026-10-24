import { McpAuthClientService } from './mcp-auth-client.service';

describe('McpAuthClientService', () => {
  let service: McpAuthClientService;

  beforeEach(() => {
    service = new McpAuthClientService();
  });

  it('returns mock connected statuses when MOCK_TOOLS=true', async () => {
    process.env.MOCK_TOOLS = 'true';
    const statuses = await service.getConnectionStatus('user-1');
    expect(statuses.length).toBeGreaterThan(0);
    expect(statuses.every((s) => s.is_connected)).toBe(true);
    expect(await service.isConnected('user-1', 'sql_server')).toBe(true);
  });
});
