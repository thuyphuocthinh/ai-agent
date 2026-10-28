import { ERefreshFormat } from '@agent/core/constants';

export enum EDynamicProviderAuthType {
  NONE = 'NONE',
  API_KEY = 'API_KEY',
  BEARER = 'BEARER',
  BASIC = 'BASIC',
  OAUTH2 = 'OAUTH2',
}

export interface DynamicProviderAuthConfig {
  clientId?: string;
  clientSecret?: string;
  tokenUrl?: string;
  authorizationUrl?: string;
  scope?: string;
  refreshRequestFormat?: ERefreshFormat;
  responseAccessTokenPath?: string;
  responseRefreshTokenPath?: string;
  responseExpiresInPath?: string;
  defaultExpiresInSecs?: number;
  [key: string]: unknown;
}

export interface DynamicProviderEntityRecord {
  id: string;
  userId: string;
  name: string;
  specUrl: string;
  description?: string;
  accessToken?: string;
  authType: EDynamicProviderAuthType;
  refreshToken?: string;
  tokenExpiresAt?: Date;
  authConfig?: DynamicProviderAuthConfig;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export type DynamicProviderRecord = DynamicProviderEntityRecord;
