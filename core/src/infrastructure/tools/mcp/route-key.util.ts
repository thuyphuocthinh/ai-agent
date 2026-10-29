/**
 * Key định tuyến dùng cho cache/breaker/limiter trong MCP connector.
 */
export function routeKey(provider: string, _workspaceId?: string): string {
  return provider;
}

/**
 * Key cho MCP Client connection cache theo provider và ownerId (tenant isolation).
 */
export function clientCacheKey(
  provider: string,
  ownerId: string | undefined,
  _workspaceId?: string,
): string {
  return `${provider}:${ownerId ?? '__anon__'}`;
}
