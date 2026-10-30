import { Injectable, Logger } from '@nestjs/common';
import { CACHE, PROVIDER_DESCRIPTIONS } from '@agent/core/constants';
import { AGENT_REGISTRY } from '../../infrastructure/tools/dynamic/agents.registry';
import { AvailableAgentDto } from '../../contracts/dtos/supervisor.dto';
import { CachedService } from '../../infrastructure/redis/cached.service';
import { McpAuthClientService } from '../../infrastructure/tools/mcp/mcp-auth-client.service';
import { DynamicProviderService } from '../../infrastructure/tools/dynamic/dynamic-provider.service';
import { buildDynamicAgentDescription } from '../supervisor/utils/supervisor-guidance-prompt.util';

/**
 * AgentDiscoveryService
 *
 * Dịch vụ khám phá & nạp danh sách Agents/Providers khả dụng của người dùng.
 * Độc lập, dùng chung cho toàn bộ Orchestration Engine (TurnResolver, AutonomousEngine, Supervisor).
 * Tích hợp Redis Singleflight Cache qua CachedService với Jitter TTL chuẩn từ cache.constant.ts.
 */
@Injectable()
export class AgentDiscoveryService {
  private readonly logger = new Logger(AgentDiscoveryService.name);

  constructor(
    private readonly mcpAuthClient: McpAuthClientService,
    private readonly dynamicProviderDb: DynamicProviderService,
    private readonly cachedService: CachedService,
  ) {}

  /**
   * Khám phá toàn bộ Agent khả dụng cho người dùng (Static MCP + Dynamic OpenAPI + System Sandbox).
   * Tự động cache qua Redis bằng Singleflight pattern để triệt tiêu tải DB.
   */
  async getAvailableAgents(
    userId: string,
    workspaceId?: string,
  ): Promise<AvailableAgentDto[]> {
    const cacheKey = CACHE.AGENTS.KEYS.AVAILABLE(userId, workspaceId ?? 'default');

    return this.cachedService.getOrSetDetail<AvailableAgentDto[]>(
      cacheKey,
      CACHE.AGENTS.SETTINGS.AVAILABLE_TTL,
      () => this.fetchAgentsFromSources(userId, workspaceId),
    );
  }

  /**
   * Trả về thông tin của một Agent tĩnh duy nhất (nếu có trong AGENT_REGISTRY).
   */
  getSingleAgent(provider: string): AvailableAgentDto[] {
    if (!AGENT_REGISTRY[provider]) return [];
    return [
      {
        provider,
        label: AGENT_REGISTRY[provider].label,
        description: PROVIDER_DESCRIPTIONS[provider] ?? '',
      },
    ];
  }

  /**
   * Xóa cache agent khi có sự kiện kết nối/ngắt kết nối provider mới
   */
  async invalidateCache(userId: string, workspaceId?: string): Promise<void> {
    const cacheKey = CACHE.AGENTS.KEYS.AVAILABLE(userId, workspaceId ?? 'default');
    await this.cachedService.invalidateDetail(cacheKey);
    this.logger.log(`Đã xóa cache agents cho user ${userId} (workspace=${workspaceId ?? 'default'})`);
  }

  private async fetchAgentsFromSources(
    userId: string,
    _workspaceId?: string,
  ): Promise<AvailableAgentDto[]> {
    // 1. Static MCP Agents
    const statuses = await this.mcpAuthClient.getConnectionStatus(userId);
    const staticAgents: AvailableAgentDto[] = statuses
      .filter(
        (status) =>
          status.is_connected && AGENT_REGISTRY[status.provider_id]?.endpoint,
      )
      .map((status) => ({
        provider: status.provider_id,
        label: AGENT_REGISTRY[status.provider_id].label,
        description: PROVIDER_DESCRIPTIONS[status.provider_id] ?? '',
      }));

    // 2. Dynamic OpenAPI Agents
    const dynamicEntities =
      await this.dynamicProviderDb.getProvidersByUser(userId);
    const dynamicAgents: AvailableAgentDto[] = dynamicEntities.map((entity) => ({
      provider: entity.id,
      label: entity.name,
      description:
        entity.description ||
        buildDynamicAgentDescription(entity.name, entity.specUrl),
    }));

    // 3. System Utility Agents (Compute/Code sandbox)
    const systemAgents = this.getSystemAgents();

    return [...staticAgents, ...systemAgents, ...dynamicAgents];
  }

  private getSystemAgents(): AvailableAgentDto[] {
    const provider = 'compute';
    if (!AGENT_REGISTRY[provider]?.endpoint) return [];
    return [
      {
        provider,
        label: AGENT_REGISTRY[provider].label,
        description: PROVIDER_DESCRIPTIONS[provider] ?? '',
      },
    ];
  }
}
