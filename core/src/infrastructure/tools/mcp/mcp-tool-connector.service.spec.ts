import { Test, TestingModule } from '@nestjs/testing';
import { McpToolConnectorService } from './mcp-tool-connector.service';
import { MockToolConnectorService } from '../mock/mock-tool-connector.service';
import { CircuitBreakerService } from '../../resilience/circuit-breaker.service';
import { ProviderConcurrencyLimiterService } from '../../resilience/provider-concurrency-limiter.service';

describe('Tool Connectors', () => {
  describe('MockToolConnectorService', () => {
    let service: MockToolConnectorService;

    beforeEach(() => {
      service = new MockToolConnectorService();
    });

    it('returns tools for sql_server provider', async () => {
      const tools = await service.getTools('sql_server');
      expect(tools.length).toBeGreaterThan(0);
      expect(tools.some((t) => t.name === 'read_query')).toBe(true);
    });

    it('returns all provider tools regardless of natural language prompt query', async () => {
      const tools = await service.getTools(
        'sql_server',
        'Tra cứu chi tiết đơn hàng 102 và lịch sử thanh toán tương ứng.',
      );
      expect(tools.length).toBeGreaterThan(0);
      expect(tools.some((t) => t.name === 'read_query')).toBe(true);
      expect(tools.some((t) => t.name === 'table_schema')).toBe(true);
    });

    it('executes mock query tool call successfully', async () => {
      const res = await service.callTool({
        provider: 'sql_server',
        name: 'read_query',
        args: { query: 'SELECT * FROM products' },
      });
      expect(res.isError).toBe(false);
      expect(res.content[0].type).toBe('text');
      expect(res.content[0].text).toContain('Giày thể thao');
    });

    it('returns mock resources', async () => {
      const resources = await service.getResources('sql_server');
      expect(resources.length).toBe(1);
      expect(resources[0].uri).toContain('mock://sql_server/schema');
    });
  });

  describe('McpToolConnectorService', () => {
    let connector: McpToolConnectorService;

    beforeEach(async () => {
      const mockCircuitBreaker = { run: jest.fn((key, fn) => fn()) };
      const mockLimiter = { run: jest.fn((key, limit, fn) => fn()) };

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          McpToolConnectorService,
          { provide: CircuitBreakerService, useValue: mockCircuitBreaker },
          { provide: ProviderConcurrencyLimiterService, useValue: mockLimiter },
        ],
      }).compile();

      connector = module.get<McpToolConnectorService>(McpToolConnectorService);
    });

    it('should instantiate cleanly', () => {
      expect(connector).toBeDefined();
    });

    it('runs cache eviction methods without error', async () => {
      await expect(connector.evictIdleClients()).resolves.not.toThrow();
      expect(() => connector.evictStaleResourceCache()).not.toThrow();
    });
  });
});
