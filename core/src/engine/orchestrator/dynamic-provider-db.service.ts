import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DynamicProviderEntity } from '../../infrastructure/database/entities/dynamic-provider.entity';
import {
  DynamicProviderAuthConfig,
  EDynamicProviderAuthType,
} from '../../contracts/dtos/dynamic-provider.dto';
import {
  CoreDynamicToolRegistryService,
  CoreOpenApiParserService,
  IDynamicProviderLoader,
} from '../../infrastructure/tools/dynamic-tool-registry.port';
import {
  DynamicProviderDto,
  RegisterDynamicProviderRequestDto,
  UpdateDynamicProviderRequestDto,
} from '../../contracts/dtos/orchestration.dto';
import { RpcException } from '@nestjs/microservices';
import { ERefreshFormat, ORCHESTRATION_ERROR } from '@agent/core/constants';
import { v4 as uuidv4 } from 'uuid';
import {
  OAuth2TokenState,
  Oauth2RefreshTokenRefresher,
} from 'agentic-openapi-parser';
import { inferOAuth2RefreshFormat } from '@agent/core/common';

export interface CreateDynamicProviderParams {
  userId: string;
  name: string;
  specUrl: string;
  accessToken?: string;
  authType?: EDynamicProviderAuthType;
  description?: string;
  refreshToken?: string;
  tokenExpiresAt?: Date;
  authConfig?: DynamicProviderAuthConfig;
}

interface OAuth2InputFields {
  accessToken?: string;
  refreshToken?: string;
  tokenExpiresAt?: Date;
  tokenUrl?: string;
  clientId?: string;
  clientSecret?: string;
  refreshRequestFormat?: ERefreshFormat;
  responseAccessTokenPath?: string;
  responseRefreshTokenPath?: string;
  responseExpiresInPath?: string;
  defaultExpiresInSecs?: number;
}

@Injectable()
export class DynamicProviderDbService implements IDynamicProviderLoader {
  private readonly logger = new Logger(DynamicProviderDbService.name);

  constructor(
    @InjectRepository(DynamicProviderEntity)
    private readonly providerRepo: Repository<DynamicProviderEntity>,
    private readonly registryService: CoreDynamicToolRegistryService,
    private readonly parserService: CoreOpenApiParserService,
  ) {}

  async loadEntity(providerId: string): Promise<DynamicProviderEntity | null> {
    return this.providerRepo.findOne({
      where: { id: providerId, isActive: true },
    });
  }

  async hasProvider(providerId: string): Promise<boolean> {
    const count = await this.providerRepo.count({
      where: { id: providerId, isActive: true },
    });
    return count > 0;
  }

  async registerProvider(
    dto: RegisterDynamicProviderRequestDto,
  ): Promise<DynamicProviderDto> {
    const fields = this.resolveOAuth2Fields(dto);
    let tokenExpiresAt: Date | undefined;

    const refreshed = await this.refreshOAuth2IfConfigured(fields);
    if (refreshed) {
      fields.accessToken = refreshed.accessToken;
      fields.refreshToken = refreshed.refreshToken;
      tokenExpiresAt = refreshed.tokenExpiresAt;
    }

    this.assertUsableAuthConfig(
      dto.authType,
      fields.accessToken,
      fields.refreshToken,
      fields.tokenUrl,
    );

    return this.createProvider({
      userId: dto.userId,
      name: dto.name,
      specUrl: dto.specUrl,
      accessToken: fields.accessToken,
      authType: dto.authType,
      description: dto.description,
      refreshToken: fields.refreshToken,
      tokenExpiresAt,
      authConfig: this.buildAuthConfig(fields),
    });
  }

  async updateProvider(
    id: string,
    userId: string,
    dto: UpdateDynamicProviderRequestDto,
  ): Promise<DynamicProviderDto> {
    const entity = await this.findOwnedProviderOrThrow(id, userId, 'update');
    const originalRefreshToken = entity.refreshToken;
    const fields = this.resolveOAuth2Fields(dto, entity);

    if (dto.authType && dto.authType !== entity.authType) {
      entity.authType = dto.authType;
    }

    const refreshed = await this.refreshOAuth2IfConfigured(fields);
    if (refreshed) {
      fields.accessToken = refreshed.accessToken;
      fields.refreshToken = refreshed.refreshToken;
      fields.tokenExpiresAt = refreshed.tokenExpiresAt;
    }

    this.assertUsableAuthConfig(
      entity.authType,
      fields.accessToken,
      fields.refreshToken,
      fields.tokenUrl,
    );

    if (dto.name !== undefined) entity.name = dto.name;
    if (dto.specUrl !== undefined) entity.specUrl = dto.specUrl;
    if (dto.description !== undefined) entity.description = dto.description;
    entity.accessToken = fields.accessToken;
    entity.refreshToken = fields.refreshToken;
    entity.tokenExpiresAt = fields.tokenExpiresAt;
    entity.authConfig = this.buildAuthConfig(fields);

    await this.persistUpdatedProvider(entity, originalRefreshToken);
    await this.reloadRegistryTools(entity, 'reload spec for updated');

    return this.mapToDto(entity);
  }

  async createProvider(
    params: CreateDynamicProviderParams,
  ): Promise<DynamicProviderDto> {
    try {
      await this.parserService.loadSpec(params.specUrl);
    } catch (parseError: any) {
      this.logger.error(
        `Failed to parse OpenAPI spec at ${params.specUrl}: ${parseError.message}`,
      );
      if (parseError instanceof RpcException) throw parseError;
      throw new RpcException({
        ...ORCHESTRATION_ERROR.INVALID_OPENAPI_SPEC,
        details: parseError.message,
      });
    }

    const entity = this.providerRepo.create({
      id: uuidv4(),
      userId: params.userId,
      name: params.name,
      specUrl: params.specUrl,
      description: params.description,
      accessToken: params.accessToken,
      authType: params.authType || EDynamicProviderAuthType.BEARER,
      refreshToken: params.refreshToken,
      tokenExpiresAt: params.tokenExpiresAt,
      authConfig: params.authConfig,
    });

    let saved: DynamicProviderEntity;
    try {
      saved = await this.providerRepo.save(entity);
      this.logger.log(
        `Registered dynamic provider "${saved.name}" with ID "${saved.id}"`,
      );
    } catch (dbError: any) {
      this.logger.error(`Failed to save provider to DB: ${dbError.message}`);
      throw new RpcException({
        ...ORCHESTRATION_ERROR.DATABASE_OPERATION_FAILED,
        details: 'Could not save dynamic provider to database',
      });
    }

    await this.reloadRegistryTools(saved, 'load spec for new');

    return this.mapToDto(saved);
  }

  async deleteProvider(id: string, userId: string): Promise<void> {
    try {
      const provider = await this.findOwnedProviderOrThrow(id, userId, 'delete');

      await this.providerRepo.remove(provider);
      this.registryService.removeProvider(id);
      this.logger.log(
        `Deleted dynamic provider "${provider.name}" with ID "${provider.id}"`,
      );
    } catch (error: any) {
      if (error instanceof RpcException) throw error;

      this.logger.error(`Failed to delete provider ${id}: ${error.message}`);
      throw new RpcException({
        ...ORCHESTRATION_ERROR.DATABASE_OPERATION_FAILED,
        details: 'Could not delete dynamic provider from database',
      });
    }
  }

  async getProvidersByUser(userId: string): Promise<DynamicProviderDto[]> {
    const entities = await this.providerRepo.find({ where: { userId } });
    return entities.map((e) => this.mapToDto(e));
  }

  private mapToDto(entity: DynamicProviderEntity): DynamicProviderDto {
    return {
      id: entity.id,
      userId: entity.userId,
      name: entity.name,
      specUrl: entity.specUrl,
      description: entity.description,
      hasAuth: !!entity.accessToken || !!entity.refreshToken,
      authType: entity.authType,
      hasAccessToken: !!entity.accessToken,
      hasRefreshToken: !!entity.refreshToken,
      hasTokenUrl: !!entity.authConfig?.tokenUrl,
      tokenExpiresAt: entity.tokenExpiresAt,
      isActive: entity.isActive,
      createdAt: entity.createdAt,
      updatedAt: entity.updatedAt,
    };
  }

  private resolveOAuth2Fields(
    dto: OAuth2InputFields,
    existing?: DynamicProviderEntity,
  ): OAuth2InputFields {
    const tokenUrl = dto.tokenUrl || existing?.authConfig?.tokenUrl;
    let refreshRequestFormat: ERefreshFormat | undefined;
    if (tokenUrl) {
      refreshRequestFormat =
        dto.refreshRequestFormat ??
        existing?.authConfig?.refreshRequestFormat ??
        inferOAuth2RefreshFormat(tokenUrl);
    }

    return {
      accessToken: dto.accessToken || existing?.accessToken,
      refreshToken: dto.refreshToken || existing?.refreshToken,
      tokenUrl,
      clientId: dto.clientId || existing?.authConfig?.clientId,
      clientSecret: dto.clientSecret || existing?.authConfig?.clientSecret,
      refreshRequestFormat,
      responseAccessTokenPath:
        dto.responseAccessTokenPath ??
        existing?.authConfig?.responseAccessTokenPath,
      responseRefreshTokenPath:
        dto.responseRefreshTokenPath ??
        existing?.authConfig?.responseRefreshTokenPath,
      responseExpiresInPath:
        dto.responseExpiresInPath ?? existing?.authConfig?.responseExpiresInPath,
      defaultExpiresInSecs:
        dto.defaultExpiresInSecs ?? existing?.authConfig?.defaultExpiresInSecs,
    };
  }

  private buildAuthConfig(
    fields: OAuth2InputFields,
  ): DynamicProviderAuthConfig | undefined {
    if (!fields.tokenUrl && !fields.clientId && !fields.clientSecret) {
      return undefined;
    }
    return {
      tokenUrl: fields.tokenUrl,
      clientId: fields.clientId,
      clientSecret: fields.clientSecret,
      refreshRequestFormat: fields.refreshRequestFormat,
      responseAccessTokenPath: fields.responseAccessTokenPath,
      responseRefreshTokenPath: fields.responseRefreshTokenPath,
      responseExpiresInPath: fields.responseExpiresInPath,
      defaultExpiresInSecs: fields.defaultExpiresInSecs,
    };
  }

  private async findOwnedProviderOrThrow(
    id: string,
    userId: string,
    verb: 'update' | 'delete',
  ): Promise<DynamicProviderEntity> {
    const entity = await this.providerRepo.findOne({ where: { id, userId } });
    if (!entity) {
      throw new RpcException({
        ...ORCHESTRATION_ERROR.DYNAMIC_PROVIDER_NOT_FOUND,
        details: `Dynamic provider ${id} not found or you don't have permission to ${verb} it.`,
      });
    }
    return entity;
  }

  private async persistUpdatedProvider(
    entity: DynamicProviderEntity,
    originalRefreshToken: string | undefined,
  ): Promise<void> {
    try {
      const result = await this.providerRepo.update(
        { id: entity.id, refreshToken: originalRefreshToken },
        {
          name: entity.name,
          specUrl: entity.specUrl,
          description: entity.description,
          authType: entity.authType,
          accessToken: entity.accessToken,
          refreshToken: entity.refreshToken,
          tokenExpiresAt: entity.tokenExpiresAt,
          authConfig: entity.authConfig as any,
        },
      );
      if (result.affected === 0) {
        throw new RpcException({
          ...ORCHESTRATION_ERROR.DYNAMIC_PROVIDER_CONCURRENT_UPDATE,
          details: `Dynamic provider ${entity.id} was modified concurrently — please retry.`,
        });
      }
      this.logger.log(
        `Updated dynamic provider "${entity.name}" with ID "${entity.id}"`,
      );
    } catch (dbError: any) {
      if (dbError instanceof RpcException) throw dbError;
      this.logger.error(`Failed to update provider in DB: ${dbError.message}`);
      throw new RpcException({
        ...ORCHESTRATION_ERROR.DATABASE_OPERATION_FAILED,
        details: 'Could not update dynamic provider in database',
      });
    }
  }

  private async reloadRegistryTools(
    entity: DynamicProviderEntity,
    action: 'load spec for new' | 'reload spec for updated',
  ): Promise<void> {
    try {
      await this.registryService.getTools(entity.id);
    } catch (err) {
      this.logger.error(
        `Failed to ${action} provider "${entity.name}": ${(err as Error).message}`,
      );
    }
  }

  private async refreshOAuth2IfConfigured(
    params: OAuth2InputFields,
  ): Promise<OAuth2TokenState | null> {
    if (!params.refreshToken || !params.tokenUrl) return null;

    const refresher = new Oauth2RefreshTokenRefresher({
      logger: this.logger,
      requestFormat: params.refreshRequestFormat,
      responseAccessTokenPath: params.responseAccessTokenPath,
      responseRefreshTokenPath: params.responseRefreshTokenPath,
      responseExpiresInPath: params.responseExpiresInPath,
      defaultExpiresInSecs: params.defaultExpiresInSecs,
    });
    const refreshed = await refresher.refreshIfNeeded({
      accessToken: params.accessToken ?? '',
      refreshToken: params.refreshToken,
      tokenExpiresAt: new Date(0),
      tokenUrl: params.tokenUrl,
      clientId: params.clientId,
      clientSecret: params.clientSecret,
    });

    if (!refreshed) {
      throw new RpcException({
        ...ORCHESTRATION_ERROR.OAUTH2_REFRESH_FAILED,
        details:
          'Could not obtain an access token using the provided refreshToken/tokenUrl/clientId/clientSecret. Please double check these values.',
      });
    }

    return refreshed;
  }

  private assertUsableAuthConfig(
    authType: EDynamicProviderAuthType | undefined,
    accessToken: string | undefined,
    refreshToken: string | undefined,
    tokenUrl: string | undefined,
  ): void {
    if (!authType || authType === EDynamicProviderAuthType.NONE) return;
    if (accessToken || (refreshToken && tokenUrl)) return;

    throw new RpcException({
      ...ORCHESTRATION_ERROR.INVALID_AUTH_CONFIG,
      details: `authType "${authType}" requires either an accessToken or a refreshToken+tokenUrl pair, but none were provided or already stored.`,
    });
  }
}
