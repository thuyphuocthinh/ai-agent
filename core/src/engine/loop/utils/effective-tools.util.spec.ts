import { McpToolDto } from '../../../contracts/dtos/mcp.dto';
import { resolveEffectiveTools } from './effective-tools.util';

const tool = (name: string): McpToolDto => ({
  name,
  description: name,
  inputSchema: { type: 'object' },
});

describe('resolveEffectiveTools', () => {
  const tools = [tool('read_query'), tool('execute_write_query'), tool('read_skill')];
  const providers = new Map([
    ['read_query', 'sql_server'],
    ['execute_write_query', 'sql_server'],
    ['read_skill', 'native'],
  ]);

  it('keeps every tool when allowedTools is missing or empty', () => {
    expect(resolveEffectiveTools(tools, providers)).toEqual(tools);
    expect(resolveEffectiveTools(tools, providers, [])).toEqual(tools);
  });

  it('keeps every tool when allowedTools contains the wildcard', () => {
    expect(resolveEffectiveTools(tools, providers, ['*'])).toEqual(tools);
  });

  it('restricts provider tools to allowedTools but always keeps native tools', () => {
    expect(
      resolveEffectiveTools(tools, providers, ['read_query']).map((t) => t.name),
    ).toEqual(['read_query', 'read_skill']);
  });

  it('does not mutate the input list', () => {
    const copy = resolveEffectiveTools(tools, providers);
    copy.pop();
    expect(tools).toHaveLength(3);
  });
});
