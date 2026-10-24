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

export const DYNAMIC_PROVIDER_LOADER = Symbol('DYNAMIC_PROVIDER_LOADER');
