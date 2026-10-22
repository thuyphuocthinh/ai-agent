import { Injectable } from '@nestjs/common';
import {
  CallToolRequestDto,
  CallToolResponseDto,
  McpResourceDto,
  McpToolDto,
} from '@agent/core/dto/mcp.dto';
import { MockProvider, errorResult } from './mock-provider';
import { MOCK_PROVIDER_ID, createMockSqlProvider } from './mock-sql.provider';
import { MOCK_SHEETS_PROVIDER_ID, createMockSheetsProvider } from './mock-sheets.provider';
import { MOCK_MAIL_PROVIDER_ID, createMockMailProvider } from './mock-mail.provider';
import { MOCK_SLACK_PROVIDER_ID, createMockSlackProvider } from './mock-slack.provider';
import { MOCK_GITHUB_PROVIDER_ID, createMockGithubProvider } from './mock-github.provider';

export { MOCK_PROVIDER_ID } from './mock-sql.provider';

// Mỗi provider giả là 1 dòng ở đây; id phải có trong AGENT_REGISTRY (agents.registry.ts)
// để Supervisor liệt kê được.
const createMockProviders = (): MockProvider[] => [
  createMockSqlProvider(),
  createMockSheetsProvider(),
  createMockMailProvider(),
  createMockSlackProvider(),
  createMockGithubProvider(),
];
// Khai tĩnh (không dựng provider lúc import, vì ToolsModule import file này cả khi không mock).
export const MOCK_PROVIDER_IDS: string[] = [
  MOCK_PROVIDER_ID,
  MOCK_SHEETS_PROVIDER_ID,
  MOCK_MAIL_PROVIDER_ID,
  MOCK_SLACK_PROVIDER_ID,
  MOCK_GITHUB_PROVIDER_ID,
];

/**
 * Thay McpClientService khi MOCK_TOOLS=true: các agent giả (xem createMockProviders) với
 * dữ liệu mẫu cố định, không gọi mạng. Chỉ để test engine/playground khi chưa có MCP
 * thật. Lệnh ghi được áp dụng vào dữ liệu trong bộ nhớ (đọc lại thấy thay đổi) và mất
 * khi khởi động lại.
 */
@Injectable()
export class MockMcpClientService {
  private readonly providers = new Map<string, MockProvider>(
    createMockProviders().map((p) => [p.id, p]),
  );

  async getTools(provider: string): Promise<McpToolDto[]> {
    return this.providers.get(provider)?.tools ?? [];
  }

  async getResources(provider?: string): Promise<McpResourceDto[]> {
    return this.providers.get(provider ?? '')?.resources.map((r) => r.dto) ?? [];
  }

  async readResource(provider?: string, uri?: string): Promise<string> {
    return (
      this.providers.get(provider ?? '')?.resources.find((r) => r.dto.uri === uri)?.read() ?? ''
    );
  }

  async callTool(dto: CallToolRequestDto): Promise<CallToolResponseDto> {
    const id = dto.provider ?? MOCK_PROVIDER_ID;
    const provider = this.providers.get(id);
    if (!provider) return errorResult(`Provider "${id}" không có trong chế độ mock`);
    if (!provider.tools.some((t) => t.name === dto.name)) {
      return errorResult(`Tool "${dto.name}" không tồn tại trong chế độ mock`);
    }
    return provider.call(dto.name, dto.args ?? {});
  }
}

/** Thay McpAuthClientService khi MOCK_TOOLS=true: mọi provider giả luôn "đã kết nối". */
@Injectable()
export class MockMcpAuthClientService {
  async getConnectionStatus() {
    return MOCK_PROVIDER_IDS.map((id) => ({
      provider_id: id,
      is_connected: true,
      status: 'connected',
      connected_at: null,
    }));
  }
}
