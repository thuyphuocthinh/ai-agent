// Key dùng cho cache/breaker/limiter trong McpClientService. Provider giữ key = provider.
export function routeKey(provider: string, _workspaceId?: string): string {
  return provider;
}

// Key cho MCP Client CONNECTION cache (McpClientService.clients).
export function clientCacheKey(
  provider: string,
  ownerId: string | undefined,
  _workspaceId?: string,
): string {
  return `${provider}:${ownerId ?? '__anon__'}`;
}
