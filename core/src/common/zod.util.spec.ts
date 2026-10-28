import { isZodSchema } from './zod.util';
import { z } from 'zod';

describe('zod.util', () => {
  it('trả về true khi input là một Zod schema hợp lệ', () => {
    expect(isZodSchema(z.string())).toBe(true);
    expect(isZodSchema(z.object({ id: z.number() }))).toBe(true);
  });

  it('trả về false khi input không phải Zod schema', () => {
    expect(isZodSchema(null)).toBe(false);
    expect(isZodSchema(undefined)).toBe(false);
    expect(isZodSchema('hello')).toBe(false);
    expect(isZodSchema(123)).toBe(false);
    expect(isZodSchema({})).toBe(false);
    expect(isZodSchema({ safeParse: 'not a function' })).toBe(false);
  });
});
