import {
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import {
  ADMIN_API_KEY_ENV,
  AdminApiKeyGuard,
} from './admin-api-key.guard';

function contextWith(headers: Record<string, string | string[] | undefined>) {
  return {
    switchToHttp: () => ({ getRequest: () => ({ headers }) }),
  } as unknown as ExecutionContext;
}

describe('AdminApiKeyGuard', () => {
  const guard = new AdminApiKeyGuard();
  const original = process.env[ADMIN_API_KEY_ENV];

  afterEach(() => {
    if (original === undefined) delete process.env[ADMIN_API_KEY_ENV];
    else process.env[ADMIN_API_KEY_ENV] = original;
  });

  it('allows a request whose x-admin-key matches the configured key', () => {
    process.env[ADMIN_API_KEY_ENV] = 'secret-key';

    expect(guard.canActivate(contextWith({ 'x-admin-key': 'secret-key' }))).toBe(true);
  });

  it('rejects every request (fail-closed) when the key is not configured', () => {
    delete process.env[ADMIN_API_KEY_ENV];

    expect(() => guard.canActivate(contextWith({ 'x-admin-key': 'anything' }))).toThrow(
      ForbiddenException,
    );
    expect(() => guard.canActivate(contextWith({}))).toThrow(ForbiddenException);
  });

  it('rejects an empty configured key the same as an unconfigured one', () => {
    process.env[ADMIN_API_KEY_ENV] = '';

    expect(() => guard.canActivate(contextWith({ 'x-admin-key': '' }))).toThrow(
      ForbiddenException,
    );
  });

  it.each([
    ['missing header', {}],
    ['wrong key', { 'x-admin-key': 'wrong' }],
    ['empty key', { 'x-admin-key': '' }],
    ['key with different length', { 'x-admin-key': 'secret-key-extra' }],
  ])('rejects %s with 401', (_label, headers) => {
    process.env[ADMIN_API_KEY_ENV] = 'secret-key';

    expect(() => guard.canActivate(contextWith(headers))).toThrow(
      UnauthorizedException,
    );
  });

  it('uses the first value when the header is repeated', () => {
    process.env[ADMIN_API_KEY_ENV] = 'secret-key';

    expect(
      guard.canActivate(contextWith({ 'x-admin-key': ['secret-key', 'other'] })),
    ).toBe(true);
    expect(() =>
      guard.canActivate(contextWith({ 'x-admin-key': ['other', 'secret-key'] })),
    ).toThrow(UnauthorizedException);
  });
});
