import { Injectable, Logger, OnModuleDestroy, Optional, Inject } from '@nestjs/common';
import { OpenAPI } from 'openapi-types';
import { RpcException } from '@nestjs/microservices';
import { McpToolDto } from '../../../contracts/dtos/mcp.dto';
import {
  EDynamicProviderAuthType,
  DynamicProviderRecord,
} from '../../../contracts/dtos/dynamic-provider.dto';
import { ORCHESTRATION_ERROR } from '../../../constants';
import { SemanticToolIndex } from 'agentic-openapi-parser';
import { OpenAiEmbeddingProvider } from '../../embedding/openai-embedding.provider';
import { OpenApiParserService } from '../openapi/openapi-parser.service';
import { OpenApiConverter } from '../openapi/openapi-converter.util';
import {
  DynamicProviderSpec,
  IDynamicProviderLoader,
  IDynamicToolRegistry,
  DYNAMIC_PROVIDER_LOADER,
} from './dynamic-tool.interface';

interface IndexableMcpTool extends McpToolDto {
  description: string;
}

const SEMANTIC_SEARCH_TOP_K = 8;
const MAX_FALLBACK_TOOLS = 16;
const DIRECT_TOOLS_THRESHOLD = 12;

interface CacheEntry {
  data: DynamicProviderSpec;
  lastAccessed: number;
  loadedAt: number;
  semanticIndex?: SemanticToolIndex<IndexableMcpTool>;
  tokenMutatedAt?: number;
}

@Injectable()
export class DynamicToolRegistryService implements IDynamicToolRegistry, OnModuleDestroy {
  private readonly logger = new Logger(DynamicToolRegistryService.name);

  // Cache trên RAM kết hợp TTL (Thời gian sống)
  private readonly registry = new Map<string, CacheEntry>();

  // Tự động giải phóng RAM sau 1 giờ không có ai sử dụng
  private readonly CACHE_TTL_MS = 60 * 60 * 1000;
  private readonly cleanupInterval: NodeJS.Timeout;

  constructor(
    private readonly parserService: OpenApiParserService,
    private readonly embeddingProvider: OpenAiEmbeddingProvider,
    @Optional()
    @Inject(DYNAMIC_PROVIDER_LOADER)
    private readonly providerLoader?: IDynamicProviderLoader,
  ) {
    this.cleanupInterval = setInterval(
      () => this.cleanupExpiredCache(),
      30 * 60 * 1000,
    );
    this.cleanupInterval.unref();
  }

  onModuleDestroy() {
    clearInterval(this.cleanupInterval);
  }

  private cleanupExpiredCache() {
    const now = Date.now();
    let deletedCount = 0;

    for (const [key, entry] of this.registry.entries()) {
      if (now - entry.lastAccessed > this.CACHE_TTL_MS) {
        this.registry.delete(key);
        deletedCount++;
      }
    }

    if (deletedCount > 0) {
      this.logger.log(
        `Cleaned up ${deletedCount} unused dynamic providers from RAM to free memory.`,
      );
    }
  }

  private async ensureLoaded(providerId: string): Promise<void> {
    const existing = this.registry.get(providerId);
    if (existing && !this.isStale(existing)) {
      existing.lastAccessed = Date.now();
      return;
    }

    await this.loadIntoCache(providerId);
  }

  private isStale(entry: CacheEntry): boolean {
    return Date.now() - entry.loadedAt > this.CACHE_TTL_MS;
  }

  markTokenRefreshed(providerId: string): void {
    const entry = this.registry.get(providerId);
    if (entry) entry.tokenMutatedAt = Date.now();
  }

  private shouldKeepRamToken(
    existing: CacheEntry | undefined,
    entity: DynamicProviderRecord,
  ): boolean {
    return (
      existing?.tokenMutatedAt !== undefined &&
      !!entity.updatedAt &&
      existing.tokenMutatedAt > entity.updatedAt.getTime()
    );
  }

  private async loadIntoCache(providerId: string): Promise<void> {
    if (!this.providerLoader) {
      throw new RpcException({
        ...ORCHESTRATION_ERROR.DYNAMIC_PROVIDER_NOT_FOUND,
        details: `Dynamic provider ${providerId} not found (no loader configured)`,
      });
    }
    const entity = await this.providerLoader.loadEntity(providerId);
    if (!entity) {
      throw new RpcException({
        ...ORCHESTRATION_ERROR.DYNAMIC_PROVIDER_NOT_FOUND,
        details: `Dynamic provider ${providerId} not found in DB`,
      });
    }

    const existing = this.registry.get(providerId);
    const keepRamToken = this.shouldKeepRamToken(existing, entity);

    try {
      const document = await this.parserService.loadSpec(entity.specUrl);
      const tools = OpenApiConverter.convertToMcpTools(document);
      const now = Date.now();

      this.registry.set(providerId, {
        data: {
          providerId,
          specUrl: entity.specUrl,
          document,
          tools,
          accessToken: keepRamToken
            ? existing!.data.accessToken
            : entity.accessToken,
          authType: entity.authType as EDynamicProviderAuthType,
          refreshToken: keepRamToken
            ? existing!.data.refreshToken
            : entity.refreshToken,
          tokenExpiresAt: keepRamToken
            ? existing!.data.tokenExpiresAt
            : entity.tokenExpiresAt,
          authConfig: entity.authConfig,
        },
        lastAccessed: now,
        loadedAt: now,
        tokenMutatedAt: keepRamToken ? existing!.tokenMutatedAt : undefined,
      });
      this.logger.log(`Lazy-loaded dynamic provider "${providerId}" into RAM.`);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Failed to lazy-load dynamic provider "${providerId}": ${message}`,
      );
      if (error instanceof RpcException) {
        throw error;
      }
      throw new RpcException({
        ...ORCHESTRATION_ERROR.INVALID_OPENAPI_SPEC,
        details: message,
      });
    }
  }

  async getTools(providerId: string, query?: string): Promise<McpToolDto[]> {
    await this.ensureLoaded(providerId);
    const entry = this.registry.get(providerId)!;
    const tools = entry.data.tools;

    // Nếu số lượng tool nhỏ (<= 12), trả về toàn bộ (zero overhead, bảo toàn 100% schemas)
    if (tools.length <= DIRECT_TOOLS_THRESHOLD) return tools;

    // Với dynamic OpenAPI đồ sộ (> 12 endpoints): dùng SemanticToolIndex có sẵn để xếp hạng Top 8
    if (query) {
      try {
        const index = await this.getOrBuildSemanticIndex(entry, tools);
        const ranked = await index.search(query, SEMANTIC_SEARCH_TOP_K);
        if (ranked.length > 0) return ranked;
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn(
          `Semantic tool search thất bại cho provider ${providerId}, fallback về ${MAX_FALLBACK_TOOLS} tools đầu: ${message}`,
        );
      }
    }

    return tools.slice(0, MAX_FALLBACK_TOOLS);
  }

  private async getOrBuildSemanticIndex(
    entry: CacheEntry,
    tools: McpToolDto[],
  ): Promise<SemanticToolIndex<IndexableMcpTool>> {
    if (entry.semanticIndex) return entry.semanticIndex;

    const index = new SemanticToolIndex<IndexableMcpTool>(
      this.embeddingProvider,
    );
    const indexable: IndexableMcpTool[] = tools.map((tool) => ({
      ...tool,
      description: tool.description ?? '',
    }));
    await index.build(indexable);

    entry.semanticIndex = index;
    return index;
  }

  async getSpec(providerId: string): Promise<OpenAPI.Document> {
    await this.ensureLoaded(providerId);
    return this.registry.get(providerId)!.data.document;
  }

  async getProviderSpec(providerId: string): Promise<DynamicProviderSpec> {
    await this.ensureLoaded(providerId);
    return this.registry.get(providerId)!.data;
  }

  registerProviderSpec(spec: DynamicProviderSpec): void {
    const now = Date.now();
    this.registry.set(spec.providerId, {
      data: spec,
      lastAccessed: now,
      loadedAt: now,
    });
  }

  async isDynamicProvider(providerId: string): Promise<boolean> {
    if (this.registry.has(providerId)) return true;
    if (!this.providerLoader) return false;
    return this.providerLoader.hasProvider(providerId);
  }

  getAllProviders(): string[] {
    return Array.from(this.registry.keys());
  }

  removeProvider(providerId: string): void {
    this.registry.delete(providerId);
    this.logger.log(`Removed dynamic provider "${providerId}"`);
  }
}
