import 'reflect-metadata';

// Công tắc MOCK_TOOLS được quyết định lúc import module, nên mỗi ca nạp lại module trong 1 registry riêng.
function loadProviders(mockTools: string | undefined): unknown[] {
  const previous = process.env.MOCK_TOOLS;
  if (mockTools === undefined) delete process.env.MOCK_TOOLS;
  else process.env.MOCK_TOOLS = mockTools;
  try {
    let providers: unknown[] = [];
    jest.isolateModules(() => {
      const { ToolsModule } = require('./tools.module');
      providers = Reflect.getMetadata('providers', ToolsModule);
    });
    return providers;
  } finally {
    if (previous === undefined) delete process.env.MOCK_TOOLS;
    else process.env.MOCK_TOOLS = previous;
  }
}

const isOverride = (provider: unknown, token: string) =>
  typeof provider === 'object' &&
  provider !== null &&
  (provider as { provide?: { name?: string } }).provide?.name === token;

describe('ToolsModule MOCK_TOOLS switch (AC-8)', () => {
  it('uses the real tool services when MOCK_TOOLS is unset or not "true"', () => {
    for (const value of [undefined, '', 'false', '1']) {
      const providers = loadProviders(value);
      const names = providers.map((p) => (typeof p === 'function' ? p.name : 'override'));

      expect(names).toEqual(expect.arrayContaining(['McpClientService', 'McpAuthClientService']));
      expect(providers.some((p) => isOverride(p, 'McpClientService'))).toBe(false);
    }
  });

  it('replaces McpClientService and McpAuthClientService with the mocks when MOCK_TOOLS=true', () => {
    const providers = loadProviders('true');

    const client = providers.find((p) => isOverride(p, 'McpClientService')) as { useClass: { name: string } };
    const auth = providers.find((p) => isOverride(p, 'McpAuthClientService')) as { useClass: { name: string } };
    expect(client.useClass.name).toBe('MockMcpClientService');
    expect(auth.useClass.name).toBe('MockMcpAuthClientService');
  });

  it('lets the Supervisor list the mock agent by giving sql_server an endpoint', () => {
    const previousEndpoint = process.env.AGENT_SQL_SERVER_URL;
    delete process.env.AGENT_SQL_SERVER_URL;
    let endpoint: string | undefined;
    try {
      const previous = process.env.MOCK_TOOLS;
      process.env.MOCK_TOOLS = 'true';
      jest.isolateModules(() => {
        require('./tools.module');
        endpoint = require('./registry/agents.registry').AGENT_REGISTRY.sql_server.endpoint;
      });
      if (previous === undefined) delete process.env.MOCK_TOOLS;
      else process.env.MOCK_TOOLS = previous;
    } finally {
      if (previousEndpoint !== undefined) process.env.AGENT_SQL_SERVER_URL = previousEndpoint;
    }

    expect(endpoint).toBeTruthy();
  });
});
