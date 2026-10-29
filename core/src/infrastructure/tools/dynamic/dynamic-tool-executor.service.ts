import { Injectable, Logger, Optional, Inject } from '@nestjs/common';
import { DynamicToolRegistryService } from './dynamic-tool-registry.service';
import { DynamicProviderSpec } from './dynamic-tool.interface';
import { CallToolResponseDto } from '../../../contracts/dtos/mcp.dto';
import { EDynamicProviderAuthType } from '../../../contracts/dtos/dynamic-provider.dto';
import { inferOAuth2RefreshFormat } from './oauth2-refresh-format.util';
import { PiiScrubProcessor } from './pii-scrub.processor';
import {
  OpenApiSecurityInjector as LibSecurityInjector,
  Oauth2RefreshTokenRefresher,
  TruncateResponseProcessor,
  DynamicToolExecutorService as LibDynamicToolExecutorService,
  ToolNotFoundError,
  ToolExecutionError,
  ResponseProcessingError,
  DynamicProviderAuthType as ELibAuthType,
  ObservabilityHooks,
} from 'agentic-openapi-parser';

export interface TokenRefreshPayload {
  providerId: string;
  accessToken?: string;
  refreshToken?: string;
  tokenExpiresAt?: Date;
  previousRefreshToken?: string;
}

export type OnTokenRefreshedCallback = (
  payload: TokenRefreshPayload,
) => Promise<void> | void;

export const ON_TOKEN_REFRESHED = Symbol.for('ON_TOKEN_REFRESHED');

@Injectable()
export class DynamicToolExecutorService {
  private readonly logger = new Logger(DynamicToolExecutorService.name);
  private readonly securityInjector = new LibSecurityInjector();
  private readonly responseProcessors = [
    new PiiScrubProcessor(),
    new TruncateResponseProcessor(),
  ];

  private readonly libExecutor = new LibDynamicToolExecutorService(
    this.securityInjector,
    this.logger,
  );

  // 2 tool call cùng provider gặp 401 đồng thời sẽ gộp lại thành 1 lần refresh duy nhất
  private readonly pendingOAuth2Refreshes = new Map<string, Promise<boolean>>();

  constructor(
    private readonly registry: DynamicToolRegistryService,
    @Optional()
    @Inject(ON_TOKEN_REFRESHED)
    private onTokenRefreshed?: OnTokenRefreshedCallback,
  ) {}

  public setOnTokenRefreshed(callback: OnTokenRefreshedCallback): void {
    this.onTokenRefreshed = callback;
  }

  /**
   * Nhận Tool Call từ LLM và thực thi HTTP request dựa trên OpenAPI spec.
   */
  async execute(
    providerId: string,
    toolName: string,
    args: Record<string, unknown>,
    _ownerId?: string,
    signal?: AbortSignal,
  ): Promise<CallToolResponseDto> {
    if (signal?.aborted) {
      throw new Error('Aborted');
    }
    try {
      this.logger.log(
        `Executing dynamic tool "${toolName}" for provider "${providerId}"`,
      );

      const providerSpec = await this.registry.getProviderSpec(providerId);
      const spec = providerSpec.document as unknown as Record<string, unknown>;

      const data = await this.executeWithReactiveRenew(
        providerId,
        providerSpec,
        spec,
        toolName,
        args,
        signal,
      );

      const responseText =
        typeof data === 'string' ? data : JSON.stringify(data, null, 2);

      return {
        isError: false,
        content: [{ type: 'text', text: responseText }],
      };
    } catch (error: unknown) {
      if (signal?.aborted) {
        throw error;
      }
      return this.handleExecutionError(error, toolName, providerId);
    }
  }

  private buildHooks(): ObservabilityHooks {
    return {
      onRetry: ({ toolName, attempt, statusCode, delayMs }) =>
        this.logger.warn(
          `Tool "${toolName}" attempt ${attempt} failed (status ${statusCode ?? 'network error'}), retrying in ${Math.round(delayMs)}ms`,
        ),
    };
  }

  private isRetrySafe(
    providerSpec: DynamicProviderSpec,
    toolName: string,
  ): boolean {
    return (
      providerSpec.tools.find((t) => t.name === toolName)?.annotations
        ?.readOnlyHint === true
    );
  }

  private callTool(
    spec: Record<string, unknown>,
    toolName: string,
    args: Record<string, unknown>,
    providerSpec: DynamicProviderSpec,
    signal?: AbortSignal,
  ): Promise<unknown> {
    const maxRetries = this.isRetrySafe(providerSpec, toolName) ? 2 : 0;
    return this.libExecutor.execute(spec, toolName, args, {
      accessToken: providerSpec.accessToken,
      authType: providerSpec.authType as unknown as ELibAuthType,
      timeout: 15000,
      responseProcessors: this.responseProcessors,
      retry: { maxRetries },
      hooks: this.buildHooks(),
      signal,
    });
  }

  private async executeWithReactiveRenew(
    providerId: string,
    providerSpec: DynamicProviderSpec,
    spec: Record<string, unknown>,
    toolName: string,
    args: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<unknown> {
    try {
      return await this.callTool(spec, toolName, args, providerSpec, signal);
    } catch (error: unknown) {
      if (
        !this.isUnauthorized(error) ||
        !(await this.tryRenewOAuth2Token(providerId, providerSpec))
      ) {
        throw error;
      }
      // Token vừa được refresh — thử lại đúng 1 lần với accessToken mới.
      return this.callTool(spec, toolName, args, providerSpec, signal);
    }
  }

  private isUnauthorized(error: unknown): boolean {
    return error instanceof ToolExecutionError && error.statusCode === 401;
  }

  private tryRenewOAuth2Token(
    providerId: string,
    providerSpec: DynamicProviderSpec,
  ): Promise<boolean> {
    const pending = this.pendingOAuth2Refreshes.get(providerId);
    if (pending) return pending;

    const refreshing = this.refreshOAuth2Token(
      providerId,
      providerSpec,
    ).finally(() => this.pendingOAuth2Refreshes.delete(providerId));
    this.pendingOAuth2Refreshes.set(providerId, refreshing);
    return refreshing;
  }

  private async refreshOAuth2Token(
    providerId: string,
    providerSpec: DynamicProviderSpec,
  ): Promise<boolean> {
    if (
      providerSpec.authType !== EDynamicProviderAuthType.OAUTH2 ||
      !providerSpec.refreshToken ||
      !providerSpec.authConfig?.tokenUrl
    ) {
      return false;
    }

    const requestFormat =
      providerSpec.authConfig?.refreshRequestFormat ??
      inferOAuth2RefreshFormat(providerSpec.authConfig?.tokenUrl);
    const refresher = new Oauth2RefreshTokenRefresher({
      logger: this.logger,
      requestFormat,
      responseAccessTokenPath: providerSpec.authConfig?.responseAccessTokenPath,
      responseRefreshTokenPath:
        providerSpec.authConfig?.responseRefreshTokenPath,
      responseExpiresInPath: providerSpec.authConfig?.responseExpiresInPath,
      defaultExpiresInSecs: providerSpec.authConfig?.defaultExpiresInSecs,
      onRefreshed: (newState) => {
        if (this.onTokenRefreshed) {
          Promise.resolve(
            this.onTokenRefreshed({
              providerId,
              accessToken: newState.accessToken,
              refreshToken: newState.refreshToken,
              tokenExpiresAt: newState.tokenExpiresAt,
              previousRefreshToken: providerSpec.refreshToken,
            }),
          ).catch((qErr: unknown) => {
            const message = qErr instanceof Error ? qErr.message : String(qErr);
            this.logger.error(
              `Failed to handle token update callback: ${message}`,
            );
          });
        }
      },
    });

    const newState = await refresher.refreshIfNeeded({
      accessToken: providerSpec.accessToken ?? '',
      refreshToken: providerSpec.refreshToken,
      tokenExpiresAt: new Date(0), // ép refresh vì vừa bị 401
      tokenUrl: providerSpec.authConfig.tokenUrl,
      clientId: providerSpec.authConfig.clientId,
      clientSecret: providerSpec.authConfig.clientSecret,
    });

    if (!newState) return false;

    providerSpec.accessToken = newState.accessToken;
    providerSpec.refreshToken = newState.refreshToken;
    providerSpec.tokenExpiresAt = newState.tokenExpiresAt;
    this.registry.markTokenRefreshed(providerId);
    this.logger.log(
      `Successfully renewed OAuth2 token for "${providerId}" after a 401`,
    );
    return true;
  }

  private handleExecutionError(
    error: unknown,
    toolName: string,
    providerId: string,
  ): CallToolResponseDto {
    if (error instanceof ToolNotFoundError) {
      return this.formatErrorResponse(
        `Tool "${toolName}" not found in spec for provider "${providerId}"`,
        'TOOL_NOT_FOUND',
        false,
      );
    }

    if (error instanceof ToolExecutionError) {
      this.logger.error(`Error executing dynamic tool: ${error.message}`);
      return this.formatErrorResponse(
        error.message,
        'DYNAMIC_PROVIDER_ERROR',
        false,
      );
    }

    if (error instanceof ResponseProcessingError) {
      this.logger.error(`Error executing dynamic tool: ${error.message}`);
      return this.formatErrorResponse(
        error.message,
        'RESPONSE_PROCESSING_ERROR',
        false,
      );
    }

    const message = error instanceof Error ? error.message : String(error);
    this.logger.error(
      `Unexpected error executing dynamic tool "${toolName}": ${message}`,
    );
    return this.formatErrorResponse(
      message,
      `UNKNOWN_ERROR:${toolName}`,
      false,
    );
  }

  private formatErrorResponse(
    message: string,
    code: string,
    retryable: boolean,
  ): CallToolResponseDto {
    return {
      isError: true,
      content: [
        {
          type: 'text',
          text: JSON.stringify({ error: true, retryable, code, message }),
        },
      ],
    };
  }
}
