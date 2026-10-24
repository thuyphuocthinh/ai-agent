import { Injectable, Logger, Optional, Inject } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { Cron, CronExpression } from '@nestjs/schedule';
import {
  IToolProvider,
  ToolContext,
} from '../../contracts/tool-provider.interface';
import {
  CallToolRequestDto,
  CallToolResponseDto,
  McpPromptDto,
  McpResourceDto,
  McpToolDto,
} from '../../contracts/dtos/mcp.dto';
import { AGENT_REGISTRY } from '../../engine/supervisor/agents.registry';
import { ORCHESTRATION_ERROR } from '../../constants';
import { CircuitBreakerService } from '../../common/circuit-breaker.service';
import { ProviderConcurrencyLimiterService } from '../../common/provider-concurrency-limiter.service';
import { abortableSleep } from '../../common/abortable-sleep.util';
import { PiiScrubberUtil } from '../../security/pii/pii-scrubber.util';

const MCP_CALL_TIMEOUT_MS = 30_000;
const MCP_CLIENT_IDLE_TTL_MS = 600_000;
const MCP_TOOLS_CACHE_TTL_MS = 300_000;
const MCP_RESOURCE_CONTENT_CACHE_TTL_MS = 300_000;
const MAX_CONCURRENT_MCP_CALLS_PER_PROVIDER = 5;

interface CacheEntry<T> {
  data: T[];
  fetchedAt: number;
}

interface ClientCacheEntry {
  promise: Promise<Client>;
  lastUsedAt: number;
}

function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  message: string,
  controller?: AbortController,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      controller?.abort();
      reject(new Error(message));
    }, ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: any) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function clientCacheKey(provider: string, ownerId?: string): string {
  return `${provider}:${ownerId ?? '__anon__'}`;
}

@Injectable()
export class McpToolConnectorService implements IToolProvider {
  private readonly logger = new Logger(McpToolConnectorService.name);
  private readonly clients = new Map<string, ClientCacheEntry>();
  private readonly toolsCache = new Map<string, CacheEntry<McpToolDto>>();
  private readonly resourcesCache = new Map<string, CacheEntry<McpResourceDto>>();
  private readonly promptsCache = new Map<string, CacheEntry<McpPromptDto>>();
  private readonly inFlightLists = new Map<string, Promise<any>>();
  private readonly resourceContentCache = new Map<
    string,
    { data: string; fetchedAt: number }
  >();

  constructor(
    @Optional()
    private readonly circuitBreaker?: CircuitBreakerService,
    @Optional()
    private readonly concurrencyLimiter?: ProviderConcurrencyLimiterService,
  ) {}

  private async getClient(provider: string, ownerId?: string): Promise<Client> {
    const cacheKey = clientCacheKey(provider, ownerId);
    const cached = this.clients.get(cacheKey);
    if (cached) {
      cached.lastUsedAt = Date.now();
      return cached.promise;
    }

    const connecting = this.connectClient(provider, ownerId);
    const entry: ClientCacheEntry = {
      promise: connecting,
      lastUsedAt: Date.now(),
    };
    this.clients.set(cacheKey, entry);
    connecting.catch(() => {
      if (this.clients.get(cacheKey) === entry) this.clients.delete(cacheKey);
    });
    return connecting;
  }

  private async connectClient(
    provider: string,
    ownerId?: string,
  ): Promise<Client> {
    const entry = AGENT_REGISTRY[provider];
    if (!entry?.endpoint) {
      throw new RpcException(ORCHESTRATION_ERROR.AGENT_NOT_REGISTERED);
    }

    const headers: Record<string, string> = {
      'X-Internal-Api-Key': process.env.MCP_SERVER_INTERNAL_API_KEY ?? '',
    };
    if (ownerId) headers['X-Owner-Id'] = ownerId;

    const client = new Client({ name: 'orchestration', version: '1.0.0' });
    const transport = new StreamableHTTPClientTransport(
      new URL(entry.endpoint),
      { requestInit: { headers } },
    );

    await withTimeout(
      client.connect(transport),
      MCP_CALL_TIMEOUT_MS,
      `MCP connect() timeout sau ${MCP_CALL_TIMEOUT_MS / 1000}s (provider=${provider})`,
    );

    this.logger.log(`Connected MCP client for provider "${provider}" at ${entry.endpoint}`);
    return client;
  }

  @Cron(CronExpression.EVERY_10_MINUTES, { name: 'evict-idle-mcp-clients' })
  async evictIdleClients(): Promise<void> {
    const now = Date.now();
    const idleEntries = Array.from(this.clients.entries()).filter(
      ([, entry]) => now - entry.lastUsedAt > MCP_CLIENT_IDLE_TTL_MS,
    );
    if (idleEntries.length === 0) return;

    this.logger.log(`evictIdleClients() closing ${idleEntries.length} idle client(s)`);
    await Promise.all(
      idleEntries.map(async ([cacheKey, entry]) => {
        if (Date.now() - entry.lastUsedAt <= MCP_CLIENT_IDLE_TTL_MS) return;
        if (this.clients.get(cacheKey) !== entry) return;
        this.clients.delete(cacheKey);
        try {
          const client = await entry.promise;
          await client.close();
        } catch (error: any) {
          this.logger.warn(`Failed to close idle client "${cacheKey}": ${error.message}`);
        }
      }),
    );
  }

  @Cron(CronExpression.EVERY_10_MINUTES, { name: 'evict-stale-resource-cache' })
  evictStaleResourceCache(): void {
    const now = Date.now();
    let evicted = 0;
    for (const [key, entry] of this.resourceContentCache.entries()) {
      if (now - entry.fetchedAt > MCP_RESOURCE_CONTENT_CACHE_TTL_MS) {
        this.resourceContentCache.delete(key);
        evicted++;
      }
    }
    if (evicted > 0) {
      this.logger.log(`evictStaleResourceCache() removed ${evicted} expired entry(s)`);
    }
  }

  private async getCachedList<T>(
    provider: string,
    cacheMap: Map<string, CacheEntry<T>>,
    fetchFn: (client: Client) => Promise<T[]>,
    signal?: AbortSignal,
  ): Promise<T[]> {
    const cached = cacheMap.get(provider);
    if (cached && Date.now() - cached.fetchedAt < MCP_TOOLS_CACHE_TTL_MS) {
      return cached.data;
    }

    const inFlightKey = `${provider}:${cacheMap === this.resourcesCache ? 'res' : cacheMap === this.promptsCache ? 'prompt' : 'tool'}`;
    const existing = this.inFlightLists.get(inFlightKey);
    if (existing) return existing;

    const fetchPromise = (async () => {
      try {
        const data = await this.withReconnect(provider, undefined, fetchFn, 3, signal);
        cacheMap.set(provider, { data, fetchedAt: Date.now() });
        return data;
      } finally {
        this.inFlightLists.delete(inFlightKey);
      }
    })();

    this.inFlightLists.set(inFlightKey, fetchPromise);
    return fetchPromise;
  }

  async getTools(
    provider: string,
    _query?: string,
    signal?: AbortSignal,
    _workspaceId?: string,
  ): Promise<McpToolDto[]> {
    const tools = await this.getCachedList(
      provider,
      this.toolsCache,
      async (client) => {
        const result = await client.listTools(undefined, { signal }).catch((e) => {
          if (e instanceof McpError && e.code === ErrorCode.MethodNotFound) {
            return { tools: [] };
          }
          throw e;
        });
        return (result.tools || []) as McpToolDto[];
      },
      signal,
    );

    return tools;
  }

  async getResources(
    provider: string,
    signal?: AbortSignal,
  ): Promise<McpResourceDto[]> {
    return this.getCachedList(
      provider,
      this.resourcesCache,
      async (client) => {
        const result = await client.listResources(undefined, { signal }).catch((e) => {
          if (e instanceof McpError && e.code === ErrorCode.MethodNotFound) {
            return { resources: [] };
          }
          throw e;
        });
        return (result.resources || []) as McpResourceDto[];
      },
      signal,
    );
  }

  async getPrompts(
    provider: string,
    signal?: AbortSignal,
  ): Promise<McpPromptDto[]> {
    return this.getCachedList(
      provider,
      this.promptsCache,
      async (client) => {
        const result = await client.listPrompts(undefined, { signal }).catch((e) => {
          if (e instanceof McpError && e.code === ErrorCode.MethodNotFound) {
            return { prompts: [] };
          }
          throw e;
        });
        return (result.prompts || []) as McpPromptDto[];
      },
      signal,
    );
  }

  async callTool(
    dto: CallToolRequestDto,
    signal?: AbortSignal,
    context?: ToolContext,
  ): Promise<CallToolResponseDto> {
    const provider = dto.provider ?? 'sql_server';
    const ownerId = context?.userId;

    return this.withReconnect(
      provider,
      ownerId,
      async (client) => {
        const raw = await client.callTool(
          { name: dto.name, arguments: dto.args },
          undefined,
          { signal: signal ?? context?.signal },
        );
        const result = raw as CallToolResponseDto;
        return this.scrubToolResult(result);
      },
      3,
      signal ?? context?.signal,
    );
  }

  async readResource(
    provider: string,
    uri: string,
    userId?: string,
    signal?: AbortSignal,
    workspaceId?: string,
  ): Promise<string> {
    const cacheKey = `${provider}:${userId ?? '__anon__'}:${uri}`;
    const cached = this.resourceContentCache.get(cacheKey);
    if (cached && Date.now() - cached.fetchedAt < MCP_RESOURCE_CONTENT_CACHE_TTL_MS) {
      return cached.data;
    }

    const content = await this.withReconnect(
      provider,
      userId,
      async (client) => {
        const result = await client.readResource({ uri });
        return (result.contents || [])
          .map((c) => ('text' in c ? c.text : ''))
          .filter(Boolean)
          .join('\n');
      },
      3,
      signal,
    );

    this.resourceContentCache.set(cacheKey, { data: content, fetchedAt: Date.now() });
    return content;
  }

  private scrubToolResult(result: CallToolResponseDto): CallToolResponseDto {
    if (!result.content || !Array.isArray(result.content)) return result;
    return {
      ...result,
      content: result.content.map((item) => {
        if (item.type !== 'text' || typeof item.text !== 'string') return item;
        return {
          ...item,
          text: PiiScrubberUtil.scrub(item.text) as string,
        };
      }),
    };
  }

  private async withReconnect<T>(
    provider: string,
    ownerId: string | undefined,
    fn: (client: Client) => Promise<T>,
    maxRetries = 3,
    signal?: AbortSignal,
  ): Promise<T> {
    const failureDomainKey = `mcp:${provider}`;
    const runInner = () =>
      this.callWithReconnect(provider, ownerId, fn, maxRetries, signal);

    const withLimiter = this.concurrencyLimiter
      ? () =>
          this.concurrencyLimiter!.run(
            failureDomainKey,
            MAX_CONCURRENT_MCP_CALLS_PER_PROVIDER,
            runInner,
            signal,
          )
      : runInner;

    return this.circuitBreaker
      ? this.circuitBreaker.run(failureDomainKey, withLimiter, signal)
      : withLimiter();
  }

  private async callWithReconnect<T>(
    provider: string,
    ownerId: string | undefined,
    fn: (client: Client) => Promise<T>,
    maxRetries: number,
    signal?: AbortSignal,
  ): Promise<T> {
    const cacheKey = clientCacheKey(provider, ownerId);
    const timeoutMsg = `MCP call timeout sau ${MCP_CALL_TIMEOUT_MS / 1000}s (${cacheKey})`;

    let attempt = 0;
    while (true) {
      if (signal?.aborted) throw new Error('Aborted');
      try {
        const client = await this.getClient(provider, ownerId);
        return await withTimeout(fn(client), MCP_CALL_TIMEOUT_MS, timeoutMsg);
      } catch (error: any) {
        attempt++;
        if (signal?.aborted) throw error;
        this.logger.warn(
          `MCP call failed for "${cacheKey}", attempt ${attempt}/${maxRetries}: ${error.message}`,
        );
        this.clients.delete(cacheKey);
        if (attempt >= maxRetries) throw error;

        const delay = 500 * Math.pow(3, attempt - 1);
        await abortableSleep(delay, signal);
      }
    }
  }
}
