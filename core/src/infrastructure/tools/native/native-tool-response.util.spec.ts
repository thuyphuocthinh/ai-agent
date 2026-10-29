import { nativeToolError, nativeToolJson } from './native-tool-response.util';

describe('native tool responses', () => {
  it('builds a non-retryable error with code and message as JSON text', () => {
    const res = nativeToolError('SKILL_NOT_FOUND', 'không có skill');

    expect(res.isError).toBe(true);
    expect(JSON.parse(res.content?.[0]?.text ?? '{}')).toEqual({
      error: true,
      retryable: false,
      code: 'SKILL_NOT_FOUND',
      message: 'không có skill',
    });
  });

  it('serialises a success value as JSON text with isError=false', () => {
    const res = nativeToolJson({ slug: 'a', tools: ['x'] });

    expect(res.isError).toBe(false);
    expect(JSON.parse(res.content?.[0]?.text ?? '{}')).toEqual({
      slug: 'a',
      tools: ['x'],
    });
  });
});
