import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import {
  DynamicProviderAuthConfig,
  DynamicProviderRecord,
  EDynamicProviderAuthType,
} from '../../../contracts/dtos/dynamic-provider.dto';
import type { IDynamicProviderLoader } from './dynamic-tool.interface';

export function mapPrismaToRecord(entity: {
  id: string;
  userId: string;
  name: string;
  specUrl: string;
  description: string | null;
  accessToken: string | null;
  authType: string;
  refreshToken: string | null;
  tokenExpiresAt: Date | null;
  authConfig: Prisma.JsonValue | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}): DynamicProviderRecord {
  return {
    id: entity.id,
    userId: entity.userId,
    name: entity.name,
    specUrl: entity.specUrl,
    description: entity.description ?? undefined,
    accessToken: entity.accessToken ?? undefined,
    authType:
      (entity.authType as EDynamicProviderAuthType) ||
      EDynamicProviderAuthType.BEARER,
    refreshToken: entity.refreshToken ?? undefined,
    tokenExpiresAt: entity.tokenExpiresAt ?? undefined,
    authConfig:
      (entity.authConfig as DynamicProviderAuthConfig | null) ?? undefined,
    isActive: entity.isActive,
    createdAt: entity.createdAt,
    updatedAt: entity.updatedAt,
  };
}

/**
 * Read-only truy cập DB cho dynamic provider.
 * Là implementation của DYNAMIC_PROVIDER_LOADER mà DynamicToolRegistryService phụ thuộc,
 * tách khỏi DynamicProviderService để đồ thị DI một chiều (Service → Registry → Repository).
 */
@Injectable()
export class DynamicProviderRepository implements IDynamicProviderLoader {
  constructor(private readonly prisma: PrismaService) {}

  async loadEntity(providerId: string): Promise<DynamicProviderRecord | null> {
    const entity = await this.prisma.dynamicProvider.findFirst({
      where: { id: providerId, isActive: true },
    });
    return entity ? mapPrismaToRecord(entity) : null;
  }

  async hasProvider(providerId: string): Promise<boolean> {
    const count = await this.prisma.dynamicProvider.count({
      where: { id: providerId, isActive: true },
    });
    return count > 0;
  }
}
