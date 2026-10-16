import { routeKey, clientCacheKey } from './route-key.util';

describe('routeKey', () => {
  it('returns provider for standard providers', () => {
    expect(routeKey('sql_server', 'workspace-A')).toBe('sql_server');
    expect(routeKey('sql_server', undefined)).toBe('sql_server');
  });

  it('clientCacheKey combines provider and ownerId for standard providers', () => {
    expect(clientCacheKey('sql_server', 'user-1', 'ws-1')).toBe('sql_server:user-1');
    expect(clientCacheKey('sql_server', undefined)).toBe('sql_server:__anon__');
  });
});
