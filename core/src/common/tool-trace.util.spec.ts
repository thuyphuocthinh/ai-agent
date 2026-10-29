import { formatToolName } from './tool-trace.util';

describe('formatToolName', () => {
  it('joins provider and tool name with a dot', () => {
    expect(formatToolName('sql_server', 'execute_write_query')).toBe(
      'sql_server.execute_write_query',
    );
  });
});
