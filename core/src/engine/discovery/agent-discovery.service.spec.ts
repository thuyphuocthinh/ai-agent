import { Test, TestingModule } from '@nestjs/testing';
import { CACHE } from '@agent/core/constants';
import { AgentDiscoveryService } from './agent-discovery.service';
import { CachedService } from '../../infrastructure/redis/cached.service';
import { McpAuthClientService } from '../../infrastructure/tools/mcp/mcp-auth-client.service';
import { DynamicProviderService } from '../../infrastructure/tools/dynamic/dynamic-provider.service';

jest.mock('../../infrastructure/tools/dynamic/agents.registry', () => ({
  AGENT_REGISTRY: {
    sql_server: { label: 'SQL Server', endpoint: 'http://mcp-server/mcp' },
    jira: { label: 'Jira', endpoint: 'http://jira/mcp' },
    compute: { label: 'Python / Tính toán', endpoint: 'http://compute/mcp' },
  },
}));

describe('AgentDiscoveryService', () => {
  let service: AgentDiscoveryService;
  let mockMcpAuthClient: { getConnectionStatus: jest.Mock };
  let mockDynamicProviderDb: { getProvidersByUser: jest.Mock };
  let mockCachedService: {
    getOrSetDetail: jest.Mock;
    invalidateDetail: jest.Mock;
  };

  beforeEach(async () => {
    mockMcpAuthClient = {
      getConnectionStatus: jest.fn().mockResolvedValue([
        { provider_id: 'sql_server', is_connected: true },
        { provider_id: 'jira', is_connected: false },
      ]),
    };

    mockDynamicProviderDb = {
      getProvidersByUser: jest.fn().mockResolvedValue([
        {
          id: 'crm_openapi',
          name: 'CRM System',
          description: 'Quản lý khách hàng',
          specUrl: 'https://crm.test/spec.json',
        },
      ]),
    };

    mockCachedService = {
      getOrSetDetail: jest.fn((_key, _ttl, fetcher) => fetcher()),
      invalidateDetail: jest.fn().mockResolvedValue(true),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AgentDiscoveryService,
        { provide: McpAuthClientService, useValue: mockMcpAuthClient },
        { provide: DynamicProviderService, useValue: mockDynamicProviderDb },
        { provide: CachedService, useValue: mockCachedService },
      ],
    }).compile();

    service = module.get<AgentDiscoveryService>(AgentDiscoveryService);
  });

  describe('getAvailableAgents', () => {
    it('sử dụng CachedService.getOrSetDetail với Singleflight và TTL chuẩn', async () => {
      const result = await service.getAvailableAgents('user-1', 'ws-1');

      expect(mockCachedService.getOrSetDetail).toHaveBeenCalledWith(
        CACHE.AGENTS.KEYS.AVAILABLE('user-1', 'ws-1'),
        CACHE.AGENTS.SETTINGS.AVAILABLE_TTL,
        expect.any(Function),
      );

      // static connected agent: sql_server
      expect(result.some((a) => a.provider === 'sql_server')).toBe(true);
      // unconnected agent: jira excluded
      expect(result.some((a) => a.provider === 'jira')).toBe(false);
      // dynamic agent: crm_openapi
      expect(result.some((a) => a.provider === 'crm_openapi')).toBe(true);
      // system agent: compute
      expect(result.some((a) => a.provider === 'compute')).toBe(true);
    });

    it('fallback workspace default khi workspaceId không được truyền', async () => {
      await service.getAvailableAgents('user-2');

      expect(mockCachedService.getOrSetDetail).toHaveBeenCalledWith(
        CACHE.AGENTS.KEYS.AVAILABLE('user-2', 'default'),
        CACHE.AGENTS.SETTINGS.AVAILABLE_TTL,
        expect.any(Function),
      );
    });

    it('trả về cache trực tiếp từ CachedService nếu đã có sẵn trong Redis', async () => {
      const cachedAgents = [
        { provider: 'cached_agent', label: 'Cached', description: 'Desc' },
      ];
      mockCachedService.getOrSetDetail.mockResolvedValueOnce(cachedAgents);

      const result = await service.getAvailableAgents('user-3');

      expect(result).toEqual(cachedAgents);
      expect(mockMcpAuthClient.getConnectionStatus).not.toHaveBeenCalled();
      expect(mockDynamicProviderDb.getProvidersByUser).not.toHaveBeenCalled();
    });
  });

  describe('getSingleAgent', () => {
    it('trả về agent nếu có trong AGENT_REGISTRY', () => {
      const agents = service.getSingleAgent('sql_server');
      expect(agents).toHaveLength(1);
      expect(agents[0].provider).toBe('sql_server');
    });

    it('trả về rỗng nếu provider không tồn tại', () => {
      const agents = service.getSingleAgent('provider_khong_ton_tai');
      expect(agents).toEqual([]);
    });
  });

  describe('invalidateCache', () => {
    it('gọi CachedService.invalidateDetail với cacheKey chuẩn', async () => {
      await service.invalidateCache('user-1', 'ws-1');

      expect(mockCachedService.invalidateDetail).toHaveBeenCalledWith(
        CACHE.AGENTS.KEYS.AVAILABLE('user-1', 'ws-1'),
      );
    });
  });
});
