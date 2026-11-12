/**
 * isStructuredPayload:
 * Kiểm tra xem một chuỗi kết quả có phải là payload máy có cấu trúc (JSON object hoặc array) hay không.
 * Giúp phân biệt kết quả thô của tool kỹ thuật với lời thoại đàm thoại tự nhiên của Agent.
 */
export function isStructuredPayload(text: string | undefined): boolean {
  if (!text) return false;
  const trimmed = text.trim();
  if (
    (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
    (trimmed.startsWith('[') && trimmed.endsWith(']'))
  ) {
    try {
      JSON.parse(trimmed);
      return true;
    } catch {
      return false;
    }
  }
  return false;
}
