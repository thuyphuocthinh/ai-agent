export const TOOL_CONSTANTS = {
  MCP_TOOLS_CACHE_TTL_MS: 5 * 60 * 1000,
  MCP_RESOURCE_CONTENT_CACHE_TTL_MS: 60 * 1000,
  MCP_CALL_TIMEOUT_MS: 30_000,
  MAX_CONCURRENT_MCP_CALLS_PER_PROVIDER: 10,
  MCP_CLIENT_IDLE_TTL_MS: 30 * 60 * 1000,
};

export const TOOL_ERRORS = {
  AGENT_NOT_REGISTERED: {
    code: 'AGENT_NOT_REGISTERED',
    message: 'Provider/agent not registered in registry',
  },
  MCP_AUTH_REQUEST_FAILED: {
    code: 'MCP_AUTH_REQUEST_FAILED',
    message: 'Failed to communicate with MCP Auth service',
  },
  INVALID_OPENAPI_SPEC: {
    code: 'INVALID_OPENAPI_SPEC',
    message: 'Invalid OpenAPI specification',
  },
  DYNAMIC_PROVIDER_NOT_FOUND: {
    code: 'DYNAMIC_PROVIDER_NOT_FOUND',
    message: 'Dynamic provider not found',
  },
};
