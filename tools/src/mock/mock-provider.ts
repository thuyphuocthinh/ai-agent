import {
  CallToolResponseDto,
  McpResourceDto,
  McpToolDto,
} from '@agent/core/dto/mcp.dto';

export interface MockResource {
  dto: McpResourceDto;
  read(): string;
}

/**
 * 1 agent giả (1 provider id trong AGENT_REGISTRY) của chế độ MOCK_TOOLS: danh sách
 * tool, resource (engine nhét vào system prompt của worker) và hàm xử lý. Việc kiểm tra
 * tên tool có tồn tại do MockMcpClientService làm, nên `call` chỉ nhận tên tool đã biết.
 */
export interface MockProvider {
  readonly id: string;
  readonly tools: McpToolDto[];
  readonly resources: MockResource[];
  call(name: string, args: Record<string, unknown>): CallToolResponseDto;
}

export const textResult = (text: string): CallToolResponseDto => ({
  content: [{ type: 'text', text }],
  isError: false,
});

export const jsonResult = (value: unknown): CallToolResponseDto =>
  textResult(JSON.stringify(value));

export const errorResult = (text: string): CallToolResponseDto => ({
  content: [{ type: 'text', text }],
  isError: true,
});

/** Phân biệt kết quả lỗi trả sớm với dữ liệu tìm được (dùng cho hàm tra cứu trả `T | kết quả lỗi`). */
export const isToolResult = (value: unknown): value is CallToolResponseDto =>
  typeof value === 'object' && value !== null && 'content' in value;

/** Lỗi tạm thời theo đúng dạng engine tự thử lại ngầm (JSON có `retryable: true`). */
export const retryableErrorResult = (message: string): CallToolResponseDto =>
  errorResult(JSON.stringify({ error: true, retryable: true, message }));

/** Tham số chuỗi không rỗng (đã trim), hoặc undefined. */
export const stringArg = (args: Record<string, unknown>, key: string): string | undefined => {
  const value = args[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
};

/** Tham số số nguyên dương, kẹp trong [1, max]; không hợp lệ thì dùng `fallback`. */
export const limitArg = (
  args: Record<string, unknown>,
  key: string,
  fallback: number,
  max = 50,
): number => {
  const value = args[key];
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? Math.min(value, max) : fallback;
};
