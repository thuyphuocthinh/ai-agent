import { Test, TestingModule } from '@nestjs/testing';
import { OpenApiParserService } from './openapi-parser.service';
import SwaggerParser from '@apidevtools/swagger-parser';
import { RpcException } from '@nestjs/microservices';
import { OpenAPI } from 'openapi-types';

jest.mock('@apidevtools/swagger-parser');

describe('OpenApiParserService', () => {
  let service: OpenApiParserService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [OpenApiParserService],
    }).compile();

    service = module.get<OpenApiParserService>(OpenApiParserService);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('loadSpec', () => {
    it('should successfully parse a valid OpenAPI spec', async () => {
      const mockDoc = {
        openapi: '3.0.0',
        info: { title: 'Test API', version: '1.0.0' },
        paths: {},
      } as unknown as OpenAPI.Document;

      (SwaggerParser.validate as jest.Mock).mockResolvedValue(mockDoc);

      const result = await service.loadSpec('https://example.com/openapi.json');

      expect(SwaggerParser.validate).toHaveBeenCalledWith(
        'https://example.com/openapi.json',
        expect.objectContaining({
          resolve: expect.objectContaining({
            http: expect.objectContaining({
              read: expect.any(Function),
            }),
          }),
        }),
      );
      expect(result).toEqual(mockDoc);
    });

    it('should throw an RpcException when parsing fails', async () => {
      const errorMessage = 'Invalid Swagger Schema';
      (SwaggerParser.validate as jest.Mock).mockRejectedValue(
        new Error(errorMessage),
      );

      await expect(
        service.loadSpec('https://example.com/invalid.json'),
      ).rejects.toThrow(RpcException);
    });
  });
});
