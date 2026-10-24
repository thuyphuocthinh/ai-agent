import { OpenAPI } from 'openapi-types';
import {
  McpToolDto,
  EDynamicProviderAuthType,
  DynamicProviderAuthConfig,
} from '../contracts';

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
