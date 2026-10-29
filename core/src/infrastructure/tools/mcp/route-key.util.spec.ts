import { routeKey, clientCacheKey } from './route-key.util';

describe('routeKey and clientCacheKey', () => {
  it('returns the provider name for routeKey', () => {
    expect(routeKey('github')).toBe('github');
    expect(routeKey('sql_server', 'tenant-1')).toBe('sql_server');
  });

  it('constructs clientCacheKey with provider and ownerId', () => {
    expect(clientCacheKey('github', 'user-123')).toBe('github:user-123');
    expect(clientCacheKey('github', undefined)).toBe('github:__anon__');
  });
});
