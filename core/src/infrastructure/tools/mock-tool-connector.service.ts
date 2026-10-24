import { Injectable, Logger } from '@nestjs/common';
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
import { MockProvider, errorResult } from './mock/mock-provider';
import { MOCK_PROVIDER_ID, createMockSqlProvider } from './mock/mock-sql.provider';
import { createMockSheetsProvider } from './mock/mock-sheets.provider';
import { createMockMailProvider } from './mock/mock-mail.provider';
import { createMockSlackProvider } from './mock/mock-slack.provider';
import { createMockGithubProvider } from './mock/mock-github.provider';

const createMockProviders = (): MockProvider[] => [
  createMockSqlProvider(),
  createMockSheetsProvider(),
  createMockMailProvider(),
  createMockSlackProvider(),
  createMockGithubProvider(),
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

  async getTools(
    provider: string,
    _query?: string,
    _signal?: AbortSignal,
    _workspaceId?: string,
  ): Promise<McpToolDto[]> {
    return this.providers.get(provider)?.tools ?? [];
  }

  async callTool(
    dto: CallToolRequestDto,
    _signal?: AbortSignal,
    _context?: ToolContext,
  ): Promise<CallToolResponseDto> {
    const id = dto.provider ?? MOCK_PROVIDER_ID;
    const provider = this.providers.get(id);
    if (!provider) {
      return errorResult(`Provider "${id}" không tồn tại trong chế độ mock`);
    }
    if (!provider.tools.some((t) => t.name === dto.name)) {
      return errorResult(`Tool "${dto.name}" không tồn tại trong chế độ mock`);
    }
    this.logger.log(`[MockToolConnector] Calling ${id}:${dto.name}`);
    return provider.call(dto.name, dto.args ?? {});
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
