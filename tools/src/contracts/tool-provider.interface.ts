export class McpToolAnnotationsDto {
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  requiredScopes?: string[];
  isIrreversible?: boolean;
}

export class McpToolDto {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
  annotations?: McpToolAnnotationsDto;
  requiredScopes?: string[];
  isIrreversible?: boolean;
}

export class CallToolRequestDto {
  name: string;
  args: Record<string, unknown>;
  provider?: string;
  ownerId?: string;
  userId?: string;
  workspaceId?: string;
  tenantId?: string;
}

export class CallToolResponseDto {
  content?: Array<{ type: string; text?: string }>;
  isError?: boolean;
}

export class McpResourceDto {
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
}

export class McpPromptDto {
  name: string;
  description?: string;
  arguments?: Array<{ name: string; description?: string; required?: boolean }>;
}

export interface ToolContext {
  userId?: string;
  tenantId?: string;
  workspaceId?: string;
  signal?: AbortSignal;
}

export const TOOL_PROVIDER = Symbol.for('TOOL_PROVIDER');

export interface IToolProvider {
  getTools(
    provider: string,
    query?: string,
    signal?: AbortSignal,
    workspaceId?: string,
  ): Promise<McpToolDto[]>;

  callTool(
    dto: CallToolRequestDto,
    signal?: AbortSignal,
  ): Promise<CallToolResponseDto>;

  getResources?(
    provider: string,
    signal?: AbortSignal,
    workspaceId?: string,
  ): Promise<McpResourceDto[]>;

  readResource?(
    provider: string,
    uri: string,
    userId: string,
    signal?: AbortSignal,
    workspaceId?: string,
  ): Promise<string>;

  isHealthy?(provider?: string): Promise<boolean>;
}

export interface ICircuitBreaker {
  run<T>(
    key: string,
    action: () => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T>;
}

export const CIRCUIT_BREAKER = Symbol('CIRCUIT_BREAKER');

export interface IProviderConcurrencyLimiter {
  run<T>(
    key: string,
    limit: number,
    action: () => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T>;
}

export const PROVIDER_CONCURRENCY_LIMITER = Symbol('PROVIDER_CONCURRENCY_LIMITER');

export enum EDynamicProviderAuthType {
  NONE = 'NONE',
  API_KEY = 'API_KEY',
  BEARER = 'BEARER',
  BASIC = 'BASIC',
  OAUTH2 = 'OAUTH2',
}

export type ERefreshFormat = 'form' | 'json';

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
