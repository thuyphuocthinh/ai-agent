import { Test, TestingModule } from '@nestjs/testing';
import {
  DynamicToolExecutorService,
  ON_TOKEN_REFRESHED,
} from './dynamic-tool-executor.service';
import { DynamicToolRegistryService } from './dynamic-tool-registry.service';
import axios from 'axios';
import { OpenAPIV3 } from 'openapi-types';
import { EDynamicProviderAuthType } from '../../../contracts/dtos/dynamic-provider.dto';

jest.mock('axios');

describe('DynamicToolExecutorService', () => {
  let service: DynamicToolExecutorService;
  let registryService: jest.Mocked<DynamicToolRegistryService>;

  beforeEach(async () => {
    const mockRegistryService = {
      getProviderSpec: jest.fn(),
      markTokenRefreshed: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DynamicToolExecutorService,
        {
          provide: DynamicToolRegistryService,
          useValue: mockRegistryService,
        },
        {
          provide: ON_TOKEN_REFRESHED,
          useValue: jest.fn().mockResolvedValue(undefined),
        },
      ],
    }).compile();

    service = module.get<DynamicToolExecutorService>(
      DynamicToolExecutorService,
    );
    registryService = module.get(DynamicToolRegistryService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should execute tool and return JSON response', async () => {
    const mockSpec: OpenAPIV3.Document = {
      openapi: '3.0.0',
      info: { title: 'Test API', version: '1.0' },
      servers: [{ url: 'https://api.test.com' }],
      paths: {
        '/users/{userId}': {
          get: {
            operationId: 'getUser',
            responses: { '200': { description: 'Success' } },
            parameters: [
              { name: 'userId', in: 'path', required: true, schema: { type: 'string' } },
            ],
          },
        },
      },
    };

    registryService.getProviderSpec.mockResolvedValue({
      providerId: 'test_provider',
      specUrl: 'https://api.test.com/spec.json',
      document: mockSpec,
      tools: [
        {
          name: 'getUser',
          description: 'Get user',
          inputSchema: { type: 'object' },
          annotations: { readOnlyHint: true },
        },
      ],
      authType: EDynamicProviderAuthType.BEARER,
      accessToken: 'valid-token',
    });

    (axios as unknown as jest.Mock).mockResolvedValue({
      status: 200,
      data: { id: '123', name: 'Alice' },
      headers: {},
    });

    const result = await service.execute('test_provider', 'getUser', {
      userId: '123',
    });

    expect(result.isError).toBe(false);
    expect(result.content[0].text).toContain('Alice');
  });

  it('should throw immediately if signal is aborted', async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(
      service.execute('test_provider', 'getUser', {}, undefined, controller.signal),
    ).rejects.toThrow('Aborted');
  });

  it('should handle tool not found gracefully', async () => {
    const mockSpec: OpenAPIV3.Document = {
      openapi: '3.0.0',
      info: { title: 'Test API', version: '1.0' },
      paths: {},
    };

    registryService.getProviderSpec.mockResolvedValue({
      providerId: 'test_provider',
      specUrl: 'https://api.test.com/spec.json',
      document: mockSpec,
      tools: [],
    });

    const result = await service.execute('test_provider', 'nonExistent', {});
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('TOOL_NOT_FOUND');
  });
});
