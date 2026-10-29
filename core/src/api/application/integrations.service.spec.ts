import { IntegrationsService } from './integrations.service';
import { McpAuthClientService } from '../../infrastructure/tools/mcp/mcp-auth-client.service';
import { NativeToolRegistryService } from '../../infrastructure/tools/native/native-tool-registry.service';

describe('IntegrationsService', () => {
  let service: IntegrationsService;
  let mockMcpAuthClient: jest.Mocked<McpAuthClientService>;
  let mockNativeRegistry: jest.Mocked<NativeToolRegistryService>;

  beforeEach(() => {
    mockMcpAuthClient = {
      getConnectionStatus: jest.fn().mockResolvedValue([
        {
          provider_id: 'github',
          is_connected: true,
          status: 'connected',
          connected_at: '2026-10-28T10:00:00Z',
        },
      ]),
      initiateConnect: jest.fn().mockResolvedValue({
        auth_url: 'https://github.com/login/oauth/authorize?state=123',
      }),
      submitCredentials: jest.fn().mockResolvedValue(undefined),
      disconnectProvider: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<McpAuthClientService>;

    mockNativeRegistry = {
      getAllTools: jest.fn().mockReturnValue([
        { name: 'db_query', description: 'Query DB', inputSchema: {} },
      ]),
    } as unknown as jest.Mocked<NativeToolRegistryService>;

    service = new IntegrationsService(mockMcpAuthClient, mockNativeRegistry);
  });

  describe('getStatuses', () => {
    it('should combine auth statuses with metadata and native tools', async () => {
      const statuses = await service.getStatuses('user-1');

      expect(mockMcpAuthClient.getConnectionStatus).toHaveBeenCalledWith('user-1');
      expect(statuses.length).toBeGreaterThan(0);

      const github = statuses.find((s) => s.providerId === 'github');
      expect(github?.isConnected).toBe(true);

      const sqlServer = statuses.find((s) => s.providerId === 'sql_server');
      expect(sqlServer?.fields?.length).toBeGreaterThan(0);

      const native = statuses.find((s) => s.providerId === 'native_business_db');
      expect(native?.isConnected).toBe(true);
    });

    it('should fallback gracefully when mcpAuthClient throws error', async () => {
      mockMcpAuthClient.getConnectionStatus.mockRejectedValue(new Error('Network error'));

      const statuses = await service.getStatuses('user-1');
      expect(statuses.length).toBeGreaterThan(0);
      const github = statuses.find((s) => s.providerId === 'github');
      expect(github?.isConnected).toBe(false);
    });
  });

  describe('initiate', () => {
    it('should return form fields directly for form-type provider', async () => {
      const res = await service.initiate('sql_server', 'user-1');
      expect(res.provider).toBe('sql_server');
      expect(res.fields).toBeDefined();
      expect(mockMcpAuthClient.initiateConnect).not.toHaveBeenCalled();
    });

    it('should call mcpAuthClient for oauth-type provider', async () => {
      const res = await service.initiate('github', 'user-1');
      expect(mockMcpAuthClient.initiateConnect).toHaveBeenCalledWith({
        provider: 'github',
        ownerId: 'user-1',
      });
      expect(res.authUrl).toBe('https://github.com/login/oauth/authorize?state=123');
    });
  });

  describe('submitCredentials', () => {
    it('should delegate to mcpAuthClient', async () => {
      const res = await service.submitCredentials({
        provider: 'sql_server',
        ownerId: 'user-1',
        credentials: { host: 'localhost' },
      });

      expect(mockMcpAuthClient.submitCredentials).toHaveBeenCalledWith({
        provider: 'sql_server',
        ownerId: 'user-1',
        credentials: { host: 'localhost' },
      });
      expect(res.success).toBe(true);
    });
  });

  describe('disconnect', () => {
    it('should delegate to mcpAuthClient', async () => {
      const res = await service.disconnect('github', 'user-1');

      expect(mockMcpAuthClient.disconnectProvider).toHaveBeenCalledWith('user-1', 'github');
      expect(res.success).toBe(true);
    });
  });
});
