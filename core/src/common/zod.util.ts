import type { ZodTypeAny } from 'zod';

/**
 * Type Guard kiểm tra an toàn một schema có phải là Zod schema hợp lệ hay không.
 * Phòng ngừa việc dùng `as any` khi thực thi `.safeParse()`.
 */
export function isZodSchema(schema: unknown): schema is ZodTypeAny {
  return (
    typeof schema === 'object' &&
    schema !== null &&
    'safeParse' in schema &&
    typeof (schema as { safeParse: unknown }).safeParse === 'function'
  );
}
