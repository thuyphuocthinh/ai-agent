import { CallToolResponseDto } from '../../../contracts/dtos/mcp.dto';

// Phản hồi lỗi chuẩn của native tool: JSON `{ error, retryable, code, message }`
// để model/engine đọc được cùng một định dạng với lỗi của các tool khác.
export function nativeToolError(
  code: string,
  message: string,
): CallToolResponseDto {
  return {
    isError: true,
    content: [
      {
        type: 'text',
        text: JSON.stringify({ error: true, retryable: false, code, message }),
      },
    ],
  };
}

export function nativeToolJson(value: unknown): CallToolResponseDto {
  return {
    isError: false,
    content: [{ type: 'text', text: JSON.stringify(value) }],
  };
}
