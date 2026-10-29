import { IToolProvider } from '../../../contracts/tools/tool-provider.interface';
import { executeApprovedTool } from './approved-tool-execution.util';

const checkpoint = { id: 'cp-1', userId: 'u1', workspaceId: 'w1' };
const pendingTool = { provider: 'sql_server', name: 'execute_write_query', args: { query: 'INSERT' } };

const makeProvider = (result: unknown) =>
  ({ callTool: jest.fn().mockResolvedValue(result) }) as unknown as IToolProvider;

describe('executeApprovedTool', () => {
  it('calls the tool, marks the checkpoint and builds a success trace', async () => {
    const markToolExecuted = jest.fn().mockResolvedValue(undefined);
    const toolProvider = makeProvider({ content: [{ type: 'text', text: 'ok' }] });

    const out = await executeApprovedTool(
      { toolProvider, markToolExecuted },
      checkpoint,
      pendingTool,
    );

    expect(markToolExecuted).toHaveBeenCalledWith({ id: 'cp-1' });
    expect(out.isError).toBe(false);
    expect(out.resultText).toBe('ok');
    expect(out.trace).toEqual({
      tool: 'sql_server.execute_write_query',
      status: 'success',
      argsPreview: JSON.stringify(pendingTool.args),
      resultPreview: 'ok',
    });
  });

  it('still marks the checkpoint when the tool returns an error', async () => {
    const markToolExecuted = jest.fn().mockResolvedValue(undefined);
    const toolProvider = makeProvider({
      isError: true,
      content: [{ type: 'text', text: 'boom' }],
    });

    const out = await executeApprovedTool(
      { toolProvider, markToolExecuted },
      checkpoint,
      pendingTool,
    );

    expect(markToolExecuted).toHaveBeenCalledTimes(1);
    expect(out.isError).toBe(true);
    expect(out.trace.status).toBe('error');
  });

  it('works without a checkpoint marker', async () => {
    const toolProvider = makeProvider({ content: [{ type: 'text', text: 'ok' }] });
    const out = await executeApprovedTool({ toolProvider }, checkpoint, pendingTool);
    expect(out.isError).toBe(false);
  });
});
