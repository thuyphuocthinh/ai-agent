import { constantTimeEqual } from './constant-time-equal.util';

describe('constantTimeEqual', () => {
  it('is true for identical strings', () => {
    expect(constantTimeEqual('secret-key', 'secret-key')).toBe(true);
  });

  it.each([
    ['secret-key', 'secret-kez'],
    ['secret-key', 'secret-key-extra'],
    ['secret-key', ''],
    ['', 'secret-key'],
  ])('is false for %j vs %j (including different lengths)', (a, b) => {
    expect(constantTimeEqual(a, b)).toBe(false);
  });

  it('treats two empty strings as equal', () => {
    expect(constantTimeEqual('', '')).toBe(true);
  });

  it('handles multi-byte characters', () => {
    expect(constantTimeEqual('khóa-bí-mật', 'khóa-bí-mật')).toBe(true);
    expect(constantTimeEqual('khóa-bí-mật', 'khoa-bi-mat')).toBe(false);
  });
});
