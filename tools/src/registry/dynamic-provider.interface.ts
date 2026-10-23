import {
  DynamicProviderAuthConfig,
  EDynamicProviderAuthType,
} from '@agent/core/contracts';

export interface CreateDynamicProviderParams {
  userId: string;
  name: string;
  specUrl: string;
  description?: string;
  accessToken?: string;
  authType?: EDynamicProviderAuthType;
  refreshToken?: string;
  tokenExpiresAt?: Date;
  authConfig?: DynamicProviderAuthConfig;
}
