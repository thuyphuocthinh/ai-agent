import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import {
  ARTIFACT_TMP_MANAGER,
  IArtifactTmpManager,
} from '../../../contracts/storage/artifact-tmp.interface';
import {
  IToolProvider,
  ToolContext,
} from '../../../contracts/tools/tool-provider.interface';
import {
  CallToolRequestDto,
  CallToolResponseDto,
  McpPromptDto,
  McpResourceDto,
  McpToolDto,
} from '../../../contracts/dtos/mcp.dto';
import { NativeToolRegistryService } from '../native/native-tool-registry.service';
import { MockProvider, errorResult } from './mock-provider';
import { MOCK_PROVIDER_ID, createMockSqlProvider } from './mock-sql.provider';
import { createMockSheetsProvider } from './mock-sheets.provider';
import { createMockMailProvider } from './mock-mail.provider';
import { createMockSlackProvider } from './mock-slack.provider';
import { createMockGithubProvider } from './mock-github.provider';
import {
  MOCK_COMPUTE_PROVIDER_ID,
  createMockComputeProvider,
} from './mock-compute.provider';
import { createMockKintoneProvider } from './mock-kintone.provider';

const createMockProviders = (): MockProvider[] => [
  createMockSqlProvider(),
  createMockSheetsProvider(),
  createMockMailProvider(),
  createMockSlackProvider(),
  createMockGithubProvider(),
  createMockComputeProvider(),
  createMockKintoneProvider(),
];

/**
 * MockToolConnectorService: In-memory fallback tool connector used when
 * MOCK_TOOLS=true or during test runs. Emulates static and dynamic providers
 * with realistic in-memory dataset without external network calls.
 */
@Injectable()
export class MockToolConnectorService implements IToolProvider {
  private readonly logger = new Logger(MockToolConnectorService.name);
  private readonly providers = new Map<string, MockProvider>(
    createMockProviders().map((p) => [p.id, p]),
  );

  // Native tool (VD read_skill) vẫn dùng được ở chế độ mock — cùng cách McpToolConnectorService.
  constructor(
    @Optional()
    private readonly nativeRegistry?: NativeToolRegistryService,
    @Optional()
    @Inject(ARTIFACT_TMP_MANAGER)
    private readonly tmpManager?: IArtifactTmpManager,
  ) {
    if (this.tmpManager) {
      this.providers.set(
        MOCK_COMPUTE_PROVIDER_ID,
        createMockComputeProvider(this.tmpManager),
      );
    }
  }

  async getTools(
    provider: string,
    _query?: string,
    _signal?: AbortSignal,
    _workspaceId?: string,
  ): Promise<McpToolDto[]> {
    if (provider === 'native') return this.nativeRegistry?.getAllTools() ?? [];
    return this.providers.get(provider)?.tools ?? [];
  }

  async callTool(
    dto: CallToolRequestDto,
    signal?: AbortSignal,
    context?: ToolContext,
  ): Promise<CallToolResponseDto> {
    const effectiveContext: ToolContext = context ?? {
      userId: dto.ownerId ?? dto.userId,
      workspaceId: dto.workspaceId,
      messageId: dto.messageId ?? dto.workspaceId,
      signal,
    };
    if (this.nativeRegistry?.hasTool(dto.name)) {
      return this.nativeRegistry.executeFromRequest(dto, effectiveContext, signal);
    }
    const id = dto.provider ?? MOCK_PROVIDER_ID;
    const provider = this.providers.get(id);
    if (!provider) {
      return errorResult(`Provider "${id}" không tồn tại trong chế độ mock`);
    }
    if (!provider.tools.some((t) => t.name === dto.name)) {
      return errorResult(`Tool "${dto.name}" không tồn tại trong chế độ mock`);
    }
    this.logger.log(`[MockToolConnector] Calling ${id}:${dto.name}`);
    return await provider.call(dto.name, dto.args ?? {}, effectiveContext);
  }

  async getResources(
    provider: string,
    _signal?: AbortSignal,
    _workspaceId?: string,
  ): Promise<McpResourceDto[]> {
    return (
      this.providers.get(provider)?.resources.map((r) => r.dto) ?? [
        {
          uri: `mock://${provider}/schema`,
          name: `${provider} Schema`,
          description: `Mock schema for ${provider}`,
          mimeType: 'application/json',
        },
      ]
    );
  }

  async getPrompts?(
    _provider: string,
    _signal?: AbortSignal,
    _workspaceId?: string,
  ): Promise<McpPromptDto[]> {
    return [];
  }

  async readResource?(
    provider: string,
    uri: string,
    _userId?: string,
    _signal?: AbortSignal,
    _workspaceId?: string,
  ): Promise<string> {
    const res = this.providers
      .get(provider)
      ?.resources.find((r) => r.dto.uri === uri);
    return res ? res.read() : '';
  }
}
