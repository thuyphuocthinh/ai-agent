// Giới hạn độ dài preview args/kết quả trong tool trace sau khi resume tool đã duyệt.
export const TOOL_TRACE_PREVIEW_MAX_CHARS = 500;

// Tên tool hiển thị trong tool trace: luôn là `provider.name`.
export function formatToolName(provider: string, name: string): string {
  return `${provider}.${name}`;
}
