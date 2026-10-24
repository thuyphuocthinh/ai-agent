import {
  McpToolDto,
  CallToolRequestDto,
  CallToolResponseDto,
  McpResourceDto,
} from './dtos/mcp.dto';

export const TOOL_PROVIDER = Symbol.for('TOOL_PROVIDER');
export const CIRCUIT_BREAKER = Symbol.for('CIRCUIT_BREAKER');
export const PROVIDER_CONCURRENCY_LIMITER = Symbol.for('PROVIDER_CONCURRENCY_LIMITER');

export interface ToolContext {
  userId?: string;
  tenantId?: string;
  workspaceId?: string;
  signal?: AbortSignal;
}

/**
 * Cổng giao tiếp thực thi và truy xuất công cụ (Tool Port).
 * Trừu tượng hóa nguồn công cụ: MCP JSON-RPC, OpenAPI Dynamic Swagger,
 * Native TypeScript Functions, hoặc n8n Webhook.
 */
export interface IToolProvider {
  /**
   * Liệt kê danh sách các công cụ khả dụng của một provider.
   */
  getTools(
    provider: string,
    query?: string,
    signal?: AbortSignal,
    workspaceId?: string,
  ): Promise<McpToolDto[]>;

  /**
   * Thực thi gọi công cụ và nhận về kết quả chuẩn hóa.
   */
  callTool(
    dto: CallToolRequestDto,
    signal?: AbortSignal,
  ): Promise<CallToolResponseDto>;

  /**
   * Truy xuất danh sách resource ngữ cảnh phụ trợ (nếu provider hỗ trợ).
   */
  getResources?(
    provider: string,
    signal?: AbortSignal,
    workspaceId?: string,
  ): Promise<McpResourceDto[]>;

  /**
   * Đọc nội dung chi tiết của một resource ngữ cảnh.
   */
  readResource?(
    provider: string,
    uri: string,
    userId?: string,
    signal?: AbortSignal,
    workspaceId?: string,
  ): Promise<string>;

  /**
   * Kiểm tra tình trạng kết nối tới provider.
   */
  isHealthy?(provider?: string): Promise<boolean>;
}
