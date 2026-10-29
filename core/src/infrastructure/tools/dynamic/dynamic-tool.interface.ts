import { OpenAPI } from 'openapi-types';
import { McpToolDto } from '../../../contracts/dtos/mcp.dto';
import {
  EDynamicProviderAuthType,
  DynamicProviderAuthConfig,
  DynamicProviderRecord,
} from '../../../contracts/dtos/dynamic-provider.dto';

export interface DynamicProviderSpec {
  providerId: string;
  specUrl: string;
  document: OpenAPI.Document;
  tools: McpToolDto[];
  accessToken?: string;
  authType?: EDynamicProviderAuthType;
  refreshToken?: string;
  tokenExpiresAt?: Date;
  authConfig?: DynamicProviderAuthConfig;
}

export const DYNAMIC_PROVIDER_LOADER = Symbol.for('DYNAMIC_PROVIDER_LOADER');
export const DYNAMIC_TOOL_REGISTRY = Symbol.for('DYNAMIC_TOOL_REGISTRY');

export interface IDynamicProviderLoader {
  loadEntity(providerId: string): Promise<DynamicProviderRecord | null>;
  hasProvider(providerId: string): Promise<boolean>;
}

export interface IDynamicToolRegistry {
  getTools(providerId: string, query?: string): Promise<McpToolDto[]>;
  removeProvider(providerId: string): void;
  isDynamicProvider(providerId: string): Promise<boolean>;
}
