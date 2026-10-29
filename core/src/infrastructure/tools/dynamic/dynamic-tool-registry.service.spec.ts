import { DynamicToolRegistryService } from './dynamic-tool-registry.service';
import { OpenApiParserService } from '../openapi/openapi-parser.service';
import { OpenAiEmbeddingProvider } from '../../embedding/openai-embedding.provider';
import { IDynamicProviderLoader } from './dynamic-tool.interface';
import { EDynamicProviderAuthType } from '../../../contracts/dtos/dynamic-provider.dto';
import { OpenAPI } from 'openapi-types';
import { RpcException } from '@nestjs/microservices';

describe('DynamicToolRegistryService', () => {
  let service: DynamicToolRegistryService;
  let mockParserService: jest.Mocked<OpenApiParserService>;
  let mockEmbeddingProvider: jest.Mocked<OpenAiEmbeddingProvider>;
  let mockLoader: jest.Mocked<IDynamicProviderLoader>;

  const sampleDoc: OpenAPI.Document = {
    openapi: '3.0.0',
    info: { title: 'Sample API', version: '1.0.0' },
    paths: {
      '/users': {
        get: {
          operationId: 'getUsers',
          summary: 'Get all users',
          responses: { '200': { description: 'Success' } },
        },
      },
    },
  };

  beforeEach(() => {
    mockParserService = {
      loadSpec: jest.fn().mockResolvedValue(sampleDoc),
    } as unknown as jest.Mocked<OpenApiParserService>;

    mockEmbeddingProvider = {
      embed: jest.fn().mockResolvedValue([0.1, 0.2, 0.3]),
    } as unknown as jest.Mocked<OpenAiEmbeddingProvider>;

    mockLoader = {
      loadEntity: jest.fn(),
      hasProvider: jest.fn(),
    };

    service = new DynamicToolRegistryService(
      mockParserService,
      mockEmbeddingProvider,
      mockLoader,
    );
  });

  afterEach(() => {
    service.onModuleDestroy();
  });

  it('should register and retrieve provider spec directly', async () => {
    service.registerProviderSpec({
      providerId: 'manual-provider',
      specUrl: 'https://api.example.com/spec.json',
      document: sampleDoc,
      tools: [
        {
          name: 'manual_getUsers',
          description: 'Get all users',
          inputSchema: { type: 'object' },
        },
      ],
      authType: EDynamicProviderAuthType.BEARER,
      accessToken: 'test-token',
    });

    const isDynamic = await service.isDynamicProvider('manual-provider');
    expect(isDynamic).toBe(true);

    const tools = await service.getTools('manual-provider');
    expect(tools).toHaveLength(1);
    expect(tools[0].name).toBe('manual_getUsers');

    const spec = await service.getSpec('manual-provider');
    expect(spec.info.title).toBe('Sample API');

    const providerSpec = await service.getProviderSpec('manual-provider');
    expect(providerSpec.accessToken).toBe('test-token');
  });

  it('should lazy-load provider from loader if not yet in cache', async () => {
    mockLoader.loadEntity.mockResolvedValue({
      id: 'db-provider',
      specUrl: 'https://api.example.com/openapi.json',
      authType: EDynamicProviderAuthType.BEARER,
      accessToken: 'loaded-token',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const tools = await service.getTools('db-provider');
    expect(mockLoader.loadEntity).toHaveBeenCalledWith('db-provider');
    expect(mockParserService.loadSpec).toHaveBeenCalledWith('https://api.example.com/openapi.json');
    expect(tools).toHaveLength(1);
    expect(tools[0].name).toBe('getUsers');
  });

  it('should throw RpcException if provider is not found in loader', async () => {
    mockLoader.loadEntity.mockResolvedValue(null);

    await expect(service.getTools('non-existent')).rejects.toThrow(RpcException);
  });

  it('should check isDynamicProvider via loader when not in RAM', async () => {
    mockLoader.hasProvider.mockResolvedValue(true);
    const result = await service.isDynamicProvider('remote-provider');
    expect(result).toBe(true);
    expect(mockLoader.hasProvider).toHaveBeenCalledWith('remote-provider');
  });

  it('should mark token refreshed and remove provider', async () => {
    service.registerProviderSpec({
      providerId: 'temp-provider',
      specUrl: 'https://example.com/spec',
      document: sampleDoc,
      tools: [],
      authType: EDynamicProviderAuthType.NONE,
    });

    expect(service.getAllProviders()).toContain('temp-provider');
    service.markTokenRefreshed('temp-provider');
    service.removeProvider('temp-provider');
    expect(service.getAllProviders()).not.toContain('temp-provider');
  });
});
