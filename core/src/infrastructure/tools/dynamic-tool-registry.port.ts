import { Injectable, Logger } from '@nestjs/common';
import SwaggerParser from '@apidevtools/swagger-parser';
import { RpcException } from '@nestjs/microservices';
import { ORCHESTRATION_ERROR } from '../../constants';

export const DYNAMIC_PROVIDER_LOADER = Symbol.for('DYNAMIC_PROVIDER_LOADER');
export const DYNAMIC_TOOL_REGISTRY = Symbol.for('DYNAMIC_TOOL_REGISTRY');
export const OPENAPI_PARSER = Symbol.for('OPENAPI_PARSER');
export const ON_TOKEN_REFRESHED = Symbol.for('ON_TOKEN_REFRESHED');

export interface TokenRefreshPayload {
  providerId: string;
  accessToken: string;
  refreshToken?: string;
  tokenExpiresAt?: Date;
}

export interface DynamicProviderRecord {
  id: string;
  name: string;
  specUrl: string;
  authType?: string;
  apiKey?: string;
  accessToken?: string;
  refreshToken?: string;
  tokenExpiresAt?: Date;
  authConfig?: any;
  ownerId?: string;
  rateLimitPerMinute?: number;
  updatedAt?: Date;
}

export interface IDynamicProviderLoader {
  loadEntity(providerId: string): Promise<DynamicProviderRecord | null>;
  hasProvider(providerId: string): Promise<boolean>;
}

export interface IDynamicToolRegistry {
  getTools(providerId: string, query?: string): Promise<any[]>;
  removeProvider(providerId: string): void;
  isDynamicProvider?(providerId: string): Promise<boolean>;
}

export interface IOpenApiParser {
  loadSpec(urlOrPath: string): Promise<any>;
}

@Injectable()
export class CoreOpenApiParserService implements IOpenApiParser {
  private readonly logger = new Logger(CoreOpenApiParserService.name);

  async loadSpec(urlOrPath: string): Promise<any> {
    try {
      this.logger.debug(`Validating OpenAPI spec from: ${urlOrPath}`);
      return await SwaggerParser.validate(urlOrPath);
    } catch (error: any) {
      this.logger.error(`Failed to parse OpenAPI spec from ${urlOrPath}: ${error.message}`);
      throw new RpcException({
        code: 'ERR.ORCHESTRATION.0301',
        message: 'INVALID_OPENAPI_SPEC',
        details: error.message,
      });
    }
  }
}

@Injectable()
export class CoreDynamicToolRegistryService implements IDynamicToolRegistry {
  private readonly dynamicProviders = new Set<string>();

  async getTools(providerId: string, _query?: string): Promise<any[]> {
    return [];
  }

  removeProvider(providerId: string): void {
    this.dynamicProviders.delete(providerId);
  }

  async isDynamicProvider(providerId: string): Promise<boolean> {
    return this.dynamicProviders.has(providerId);
  }
}
