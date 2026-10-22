import { readUIMessageStream } from 'ai';
import type { UIMessage, UIMessageChunk } from 'ai';
import { AgentStreamService } from './agent-stream.service';
import {
  AgentStreamContext,
  AgentStreamStep,
} from './stream-sink.interface';
import {
  AgentStepSource,
  VercelUiStreamAdapter,
} from './vercel-ui-stream.adapter';

// Dùng `ai@7` THẬT làm trọng tài (readUIMessageStream): nếu chunk sai cấu trúc
// hay sai tên field, hàm này không dựng được UIMessage đúng — khác hẳn việc so
// sánh chuỗi với chính code đã viết ra chúng.
class FakeSource implements AgentStepSource {
  listeners: Array<(c: AgentStreamContext, s: AgentStreamStep) => void> = [];

  onStep(listener: (c: AgentStreamContext, s: AgentStreamStep) => void) {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  emit(context: AgentStreamContext, step: AgentStreamStep) {
    this.listeners.forEach((l) => l(context, step));
  }
}

const MESSAGE_ID = 'reply-1';
const context = (overrides: Partial<AgentStreamContext> = {}) => ({
  userId: 'user-1',
  messageId: MESSAGE_ID,
  ...overrides,
});

type Event = [AgentStreamStep, Partial<AgentStreamContext>?];

async function run(events: Event[], write?: (c: UIMessageChunk) => void) {
  const chunks: UIMessageChunk[] = [];
  const source = new FakeSource();
  const adapter = new VercelUiStreamAdapter({
    messageId: MESSAGE_ID,
    write: write ?? ((chunk) => void chunks.push(chunk)),
  });
  const detach = adapter.attach(source);
  for (const [step, overrides] of events) {
    source.emit(context(overrides), step);
  }
  await adapter.flush();
  return { chunks, adapter, source, detach };
}

async function readMessage(chunks: UIMessageChunk[]): Promise<UIMessage> {
  const stream = new ReadableStream<UIMessageChunk>({
    start(controller) {
      chunks.forEach((chunk) => controller.enqueue(chunk));
      controller.close();
    },
  });
  let last: UIMessage | undefined;
  for await (const message of readUIMessageStream({ stream })) {
    last = message;
  }
  if (!last) throw new Error('no message was produced');
  return last;
}

const types = (chunks: UIMessageChunk[]) => chunks.map((c) => c.type);

describe('VercelUiStreamAdapter (AC-2, AC-3, AC-7)', () => {
  describe('text streaming', () => {
    it('emits a well-formed text stream that real `ai` reads back as the same text', async () => {
      const { chunks } = await run([
        [{ type: 'step_start', label: 'SQL Server: liệt kê bảng' }],
        [{ type: 'token', text: 'Có ' }],
        [{ type: 'token', text: '2 bảng.' }],
        [{ type: 'done' }],
      ]);

      expect(types(chunks)).toEqual([
        'start',
        'start-step',
        'data-status',
        'text-start',
        'text-delta',
        'text-delta',
        'text-end',
        'finish-step',
        'finish',
      ]);
      const message = await readMessage(chunks);
      expect(message.id).toBe(MESSAGE_ID);
      expect(message.parts).toContainEqual(
        expect.objectContaining({ type: 'text', text: 'Có 2 bảng.' }),
      );
    });

    it('skips empty tokens', async () => {
      const { chunks } = await run([
        [{ type: 'token', text: '' }],
        [{ type: 'token' }],
      ]);

      expect(chunks).toEqual([]);
    });

    it('opens a new text part after a tool call instead of reusing a closed one', async () => {
      const { chunks } = await run([
        [{ type: 'token', text: 'Để mình kiểm tra.' }],
        [{ type: 'tool_call', tool: 'sql.read_query', toolCallId: 'c1', argsPreview: '{}' }],
        [{ type: 'tool_result', tool: 'sql.read_query', toolCallId: 'c1', status: 'success' as never, resultPreview: '[]' }],
        [{ type: 'token', text: 'Không có dữ liệu.' }],
        [{ type: 'done' }],
      ]);

      const message = await readMessage(chunks);
      expect(message.parts.map((p) => p.type)).toEqual([
        'step-start',
        'text',
        'dynamic-tool',
        'text',
      ]);
    });

    it('keeps agents that stream in parallel (different streamKey) in separate text parts', async () => {
      const { chunks } = await run([
        [{ type: 'token', text: 'A1 ' }, { streamKey: 'r0-sql' }],
        [{ type: 'token', text: 'B1 ' }, { streamKey: 'r0-hr' }],
        [{ type: 'token', text: 'A2' }, { streamKey: 'r0-sql' }],
        [{ type: 'token', text: 'B2' }, { streamKey: 'r0-hr' }],
        [{ type: 'done' }],
      ]);

      const message = await readMessage(chunks);
      const texts = message.parts
        .filter((p) => p.type === 'text')
        .map((p) => (p as { text: string }).text);
      expect(texts.sort()).toEqual(['A1 A2', 'B1 B2']);
    });

    it('handles parallel sub-agents starting and streaming concurrently without clobbering text or stranding status', async () => {
      const personaA = { role: 'SQL Analyst', goal: 'Get revenue' };
      const personaB = { role: 'Jira Tracker', goal: 'Count bugs' };

      const { chunks } = await run([
        [{ type: 'step_start', label: 'Planning...', kind: 'planning' }, { streamKey: 'planning' }],
        [{ type: 'step_start', label: 'SQL Server: get revenue', persona: personaA }, { streamKey: 'r0-sql' }],
        [{ type: 'step_start', label: 'Jira: count bugs', persona: personaB }, { streamKey: 'r1-jira' }],
        [{ type: 'token', text: 'Revenue: ' }, { streamKey: 'r0-sql' }],
        [{ type: 'token', text: 'Bugs: ' }, { streamKey: 'r1-jira' }],
        [{ type: 'token', text: '$1,000' }, { streamKey: 'r0-sql' }],
        [{ type: 'token', text: '5 open' }, { streamKey: 'r1-jira' }],
        [{ type: 'done' }],
      ]);

      const message = await readMessage(chunks);
      expect(message.id).toBe(MESSAGE_ID);

      expect(message.parts).toContainEqual(
        expect.objectContaining({ type: 'data-persona', data: personaA }),
      );
      expect(message.parts).toContainEqual(
        expect.objectContaining({ type: 'data-persona', data: personaB }),
      );

      expect(message.parts).toContainEqual(
        expect.objectContaining({ type: 'data-status', data: { label: 'SQL Server: get revenue' } }),
      );
      expect(message.parts).toContainEqual(
        expect.objectContaining({ type: 'data-status', data: { label: 'Jira: count bugs' } }),
      );

      const texts = message.parts
        .filter((p) => p.type === 'text')
        .map((p) => (p as { text: string }).text);
      expect(texts.sort()).toEqual(['Bugs: 5 open', 'Revenue: $1,000']);
    });
  });

  describe('tool calls', () => {
    const success = 'success' as never;
    const error = 'error' as never;

    it('pairs each tool result with its own call, even for the same tool called twice', async () => {
      const { chunks } = await run([
        [{ type: 'tool_call', tool: 'sql.read_query', toolCallId: 'c1', argsPreview: '{\n  "table": "a"\n}' }],
        [{ type: 'tool_call', tool: 'sql.read_query', toolCallId: 'c2', argsPreview: '{\n  "table": "b"\n}' }],
        [{ type: 'tool_result', tool: 'sql.read_query', toolCallId: 'c2', status: success, resultPreview: 'B-ROWS' }],
        [{ type: 'tool_result', tool: 'sql.read_query', toolCallId: 'c1', status: success, resultPreview: 'A-ROWS' }],
        [{ type: 'done' }],
      ]);

      const message = await readMessage(chunks);
      const tools = message.parts.filter((p) => p.type === 'dynamic-tool') as Array<{
        toolCallId: string;
        toolName: string;
        state: string;
        input: unknown;
        output: unknown;
      }>;
      expect(tools).toHaveLength(2);
      const byId = Object.fromEntries(tools.map((t) => [t.toolCallId, t]));
      expect(byId.c1).toMatchObject({ toolName: 'sql.read_query', state: 'output-available', input: { table: 'a' }, output: 'A-ROWS' });
      expect(byId.c2).toMatchObject({ toolName: 'sql.read_query', state: 'output-available', input: { table: 'b' }, output: 'B-ROWS' });
    });

    it('wraps a non-JSON args preview (raw SQL/code) as { preview }', async () => {
      const { chunks } = await run([
        [{ type: 'tool_call', tool: 'sql.read_query', toolCallId: 'c1', argsPreview: 'SELECT 1' }],
      ]);

      expect(chunks.find((c) => c.type === 'tool-input-available')).toMatchObject({
        input: { preview: 'SELECT 1' },
      });
    });

    it('uses an empty input when there is no args preview', async () => {
      const { chunks } = await run([
        [{ type: 'tool_call', tool: 'sql.ping', toolCallId: 'c1' }],
      ]);

      expect(chunks.find((c) => c.type === 'tool-input-available')).toMatchObject({
        input: {},
      });
    });

    it('reports a failed tool as output-error', async () => {
      const { chunks } = await run([
        [{ type: 'tool_call', tool: 'sql.read_query', toolCallId: 'c1' }],
        [{ type: 'tool_result', tool: 'sql.read_query', toolCallId: 'c1', status: error, resultPreview: 'ECONNREFUSED' }],
        [{ type: 'done' }],
      ]);

      const message = await readMessage(chunks);
      expect(message.parts).toContainEqual(
        expect.objectContaining({
          type: 'dynamic-tool',
          state: 'output-error',
          errorText: 'ECONNREFUSED',
        }),
      );
    });

    it('announces an orphan tool_result (blocked before any tool_call) so the part stays valid', async () => {
      const { chunks } = await run([
        [{ type: 'tool_result', tool: 'sql.read_query', toolCallId: 'c9', status: error, resultPreview: 'bị chặn vì lặp' }],
        [{ type: 'done' }],
      ]);

      expect(types(chunks).indexOf('tool-input-available')).toBeLessThan(
        types(chunks).indexOf('tool-output-error'),
      );
      const message = await readMessage(chunks);
      expect(message.parts).toContainEqual(
        expect.objectContaining({ type: 'dynamic-tool', toolCallId: 'c9', state: 'output-error' }),
      );
    });

    it('pairs by tool name, in order, when a producer sends no toolCallId', async () => {
      const { chunks } = await run([
        [{ type: 'tool_call', tool: 'sql.read_query' }],
        [{ type: 'tool_call', tool: 'sql.read_query' }],
        [{ type: 'tool_result', tool: 'sql.read_query', status: success, resultPreview: 'first' }],
        [{ type: 'tool_result', tool: 'sql.read_query', status: success, resultPreview: 'second' }],
        [{ type: 'done' }],
      ]);

      const message = await readMessage(chunks);
      const outputs = message.parts
        .filter((p) => p.type === 'dynamic-tool')
        .map((p) => (p as { output: unknown }).output);
      expect(outputs).toEqual(['first', 'second']);
    });

    it('does not announce the same toolCallId twice', async () => {
      const { chunks } = await run([
        [{ type: 'tool_call', tool: 'sql.read_query', toolCallId: 'c1' }],
        [{ type: 'tool_call', tool: 'sql.read_query', toolCallId: 'c1' }],
      ]);

      expect(types(chunks).filter((t) => t === 'tool-input-available')).toHaveLength(1);
    });
  });

  describe('persona (AC-7)', () => {
    it('emits data-persona right after start-step and before the step tool chunks', async () => {
      const persona = {
        role: 'Thanh tra Gian lận Tài chính',
        goal: 'Tìm nguyên nhân',
        constraints: ['Chỉ đọc'],
        tone: 'Thận trọng',
      };
      const { chunks } = await run(
        [
          [{ type: 'step_start', label: 'SQL: kiểm tra', persona }, { streamKey: 'r0-sql' }],
          [{ type: 'tool_call', tool: 'sql.read_query', toolCallId: 'c1' }, { streamKey: 'r0-sql' }],
          [{ type: 'done' }],
        ],
      );

      const order = types(chunks);
      expect(order.indexOf('start-step')).toBeLessThan(order.indexOf('data-persona' as never));
      expect(order.indexOf('data-persona' as never)).toBeLessThan(order.indexOf('tool-input-available'));
      const message = await readMessage(chunks);
      expect(message.parts).toContainEqual(
        expect.objectContaining({ type: 'data-persona', data: persona }),
      );
    });

    it('emits no data-persona for a step without persona', async () => {
      const { chunks } = await run([[{ type: 'step_start', label: 'x' }]]);

      expect(types(chunks)).not.toContain('data-persona');
    });
  });

  describe('planning and step status (AC-8)', () => {
    it('emits data-status when step_start has a label (planning or worker delegation)', async () => {
      const { chunks } = await run([
        [
          {
            type: 'step_start',
            label: '🧠 Đang phân tích yêu cầu và lập kế hoạch...',
            kind: 'planning',
          },
          { streamKey: 'planning' },
        ],
        [{ type: 'done' }],
      ]);

      const statusChunk = chunks.find((c) => (c.type as string) === 'data-status');
      expect(statusChunk).toBeDefined();
      expect(statusChunk).toMatchObject({
        type: 'data-status',
        id: 'planning',
        data: {
          label: '🧠 Đang phân tích yêu cầu và lập kế hoạch...',
          kind: 'planning',
        },
      });
    });

    it('emits no data-status when step_start has no label', async () => {
      const { chunks } = await run([[{ type: 'step_start' }], [{ type: 'done' }]]);
      expect(types(chunks)).not.toContain('data-status');
    });
  });

  describe('tool calls with friendlySummary (AC-9)', () => {
    it('passes friendlySummary as title and in toolMetadata of tool-input-available', async () => {
      const { chunks } = await run([
        [
          {
            type: 'tool_call',
            tool: 'sql_server.execute_write_query',
            toolCallId: 'call-1',
            argsPreview: '{"query":"UPDATE Orders SET Status=\'Done\'"}',
            friendlySummary: '✏️ Cập nhật dữ liệu bảng Orders',
          },
        ],
        [{ type: 'done' }],
      ]);

      const toolChunk = chunks.find((c) => c.type === 'tool-input-available') as any;
      expect(toolChunk).toBeDefined();
      expect(toolChunk.title).toBe('✏️ Cập nhật dữ liệu bảng Orders');
      expect(toolChunk.toolMetadata).toEqual({
        friendlySummary: '✏️ Cập nhật dữ liệu bảng Orders',
      });
    });
  });

  describe('resync', () => {
    it('does not emit data-resync when resync restores exactly what was streamed', async () => {
      const { chunks } = await run([
        [{ type: 'token', text: 'ok' }],
        [{ type: 'resync', text: 'ok' }],
        [{ type: 'done' }],
      ]);

      expect(types(chunks)).not.toContain('data-resync');
    });

    it('does not emit data-resync for the resync("") that precedes a tool call', async () => {
      const { chunks } = await run([
        [{ type: 'token', text: 'Để mình kiểm tra' }],
        [{ type: 'resync', text: '' }],
        [{ type: 'tool_call', tool: 'sql.read_query', toolCallId: 'c1' }],
      ]);

      expect(types(chunks)).not.toContain('data-resync');
    });

    it('reports the authoritative text when the engine reverts what it streamed', async () => {
      const { chunks } = await run([
        [{ type: 'token', text: 'ok' }],
        [{ type: 'token', text: ' vẫn giữ nguyên' }], // vòng self-check bị revert
        [{ type: 'resync', text: 'ok' }],
        [{ type: 'done' }],
      ]);

      expect(chunks.find((c) => (c.type as string) === 'data-resync')).toMatchObject({
        id: 'main',
        data: { text: 'ok' },
      });
      // Vẫn là 1 stream hợp lệ: text append-only không bị phá.
      await expect(readMessage(chunks)).resolves.toBeDefined();
    });
  });

  describe('turn lifecycle', () => {
    it('produces a valid stream even when the turn ends with no content', async () => {
      const { chunks } = await run([[{ type: 'done' }]]);

      expect(types(chunks)).toEqual(['start', 'finish']);
      await expect(readMessage(chunks)).resolves.toBeDefined();
    });

    it('finishes only once and ignores events after done', async () => {
      const { chunks, source } = await run([
        [{ type: 'token', text: 'a' }],
        [{ type: 'done' }],
        [{ type: 'token', text: 'muộn' }],
        [{ type: 'done' }],
      ]);

      expect(types(chunks).filter((t) => t === 'finish')).toHaveLength(1);
      expect(types(chunks).filter((t) => t === 'text-delta')).toHaveLength(1);
      expect(source.listeners).toHaveLength(0);
    });

    it('ignores events of other messages', async () => {
      const { chunks } = await run([
        [{ type: 'token', text: 'của tin khác' }, { messageId: 'other-message' }],
        [{ type: 'done' }, { messageId: 'other-message' }],
      ]);

      expect(chunks).toEqual([]);
    });

    it('stops listening when detached', async () => {
      const { chunks, source, detach } = await run([[{ type: 'token', text: 'a' }]]);
      const before = chunks.length;

      detach();
      source.emit(context(), { type: 'token', text: 'b' });

      expect(source.listeners).toHaveLength(0);
      expect(chunks).toHaveLength(before);
    });

    it('preserves chunk order with an async writer', async () => {
      const written: string[] = [];
      const slowWriter = async (chunk: UIMessageChunk) => {
        await new Promise((resolve) => setTimeout(resolve, chunk.type === 'text-start' ? 15 : 0));
        written.push(chunk.type);
      };

      await run(
        [
          [{ type: 'token', text: 'a' }],
          [{ type: 'done' }],
        ],
        slowWriter,
      );

      expect(written).toEqual(['start', 'start-step', 'text-start', 'text-delta', 'text-end', 'finish-step', 'finish']);
    });

    it('never throws into the engine when the writer fails, and stops writing', async () => {
      const written: string[] = [];
      const failingWriter = (chunk: UIMessageChunk) => {
        if (chunk.type === 'text-start') throw new Error('socket closed');
        written.push(chunk.type);
      };
      const source = new FakeSource();
      const adapter = new VercelUiStreamAdapter({ messageId: MESSAGE_ID, write: failingWriter });
      adapter.attach(source);

      expect(() => {
        source.emit(context(), { type: 'token', text: 'a' });
        source.emit(context(), { type: 'token', text: 'b' });
        source.emit(context(), { type: 'done' });
      }).not.toThrow();
      await adapter.flush();

      expect(written).toEqual(['start', 'start-step']);
      expect(source.listeners).toHaveLength(0);
    });
  });

  describe('late binding and custom chunks', () => {
    const lateBound = () => {
      const chunks: UIMessageChunk[] = [];
      const source = new FakeSource();
      const adapter = new VercelUiStreamAdapter({
        write: (chunk) => void chunks.push(chunk),
      });
      adapter.attach(source);
      return { chunks, source, adapter };
    };

    it('ignores every event until a messageId is bound', async () => {
      const { chunks, source, adapter } = lateBound();

      source.emit(context(), { type: 'token', text: 'chưa bind' });
      await adapter.flush();

      expect(chunks).toEqual([]);
      expect(adapter.boundMessageId).toBeUndefined();
    });

    it('follows the bound messageId and only the first bind counts', async () => {
      const { chunks, source, adapter } = lateBound();

      adapter.bind(MESSAGE_ID);
      adapter.bind('another-message');
      source.emit(context(), { type: 'token', text: 'a' });
      source.emit(context({ messageId: 'another-message' }), { type: 'token', text: 'b' });
      await adapter.flush();

      expect(adapter.boundMessageId).toBe(MESSAGE_ID);
      expect(chunks.filter((c) => c.type === 'text-delta')).toHaveLength(1);
    });

    it('sends custom chunks in order with the engine chunks, and a valid message results', async () => {
      const { chunks, source, adapter } = lateBound();
      adapter.bind(MESSAGE_ID);

      source.emit(context(), { type: 'token', text: 'Xin chào' });
      adapter.send({ type: 'data-reply', data: { text: 'Câu trả lời cuối' } });
      source.emit(context(), { type: 'done' });
      await adapter.flush();

      const order = types(chunks);
      expect(order.indexOf('text-delta')).toBeLessThan(order.indexOf('data-reply' as never));
      expect(order.indexOf('data-reply' as never)).toBeLessThan(order.indexOf('finish'));
      const message = await readMessage(chunks);
      expect(message.parts).toContainEqual(
        expect.objectContaining({ type: 'data-reply', data: { text: 'Câu trả lời cuối' } }),
      );
    });

    it('starts the stream by itself when the first thing sent is a custom chunk (error before any step)', async () => {
      const { chunks, adapter } = lateBound();
      adapter.bind(MESSAGE_ID);

      adapter.send({ type: 'data-reply', data: { text: '⚠️ Lỗi hệ thống' } });
      await adapter.flush();

      expect(types(chunks)).toEqual(['start', 'data-reply']);
    });

    it('does not send before binding or after finish', async () => {
      const { chunks, source, adapter } = lateBound();

      adapter.send({ type: 'data-reply', data: { text: 'sớm' } });
      adapter.bind(MESSAGE_ID);
      source.emit(context(), { type: 'done' });
      adapter.send({ type: 'data-reply', data: { text: 'muộn' } });
      await adapter.flush();

      expect(types(chunks)).toEqual(['start', 'finish']);
    });
  });

  describe('backward compatibility with existing sinks (AC-3)', () => {
    it('leaves other listeners of the real AgentStreamService untouched', async () => {
      const service = new AgentStreamService();
      const cliSeen: AgentStreamStep[] = [];
      service.onStep((_ctx, step) => cliSeen.push(step));

      const chunks: UIMessageChunk[] = [];
      const adapter = new VercelUiStreamAdapter({
        messageId: MESSAGE_ID,
        write: (chunk) => void chunks.push(chunk),
      });
      adapter.attach(service);

      const steps: AgentStreamStep[] = [
        { type: 'step_start', label: 'SQL: liệt kê bảng' },
        { type: 'tool_call', tool: 'sql.read_query', toolCallId: 'c1', argsPreview: '{}' },
        { type: 'tool_result', tool: 'sql.read_query', toolCallId: 'c1', resultPreview: '[]' },
        { type: 'done' },
      ];
      for (const step of steps) {
        await service.emitStep(context(), step);
      }
      await adapter.flush();

      expect(cliSeen).toEqual(steps);
      expect(types(chunks)).toContain('tool-output-available');
      await service.onModuleDestroy();
    });

    it('streams batched tokens from the real AgentStreamService in order', async () => {
      const service = new AgentStreamService();
      const chunks: UIMessageChunk[] = [];
      const adapter = new VercelUiStreamAdapter({
        messageId: MESSAGE_ID,
        write: (chunk) => void chunks.push(chunk),
      });
      adapter.attach(service);

      await service.emitToken(context(), 'Xin ');
      await service.emitToken(context(), 'chào');
      await service.emitStep(context(), { type: 'done' }); // drain batch trước done
      await adapter.flush();

      const message = await readMessage(chunks);
      expect(message.parts).toContainEqual(
        expect.objectContaining({ type: 'text', text: 'Xin chào' }),
      );
      await service.onModuleDestroy();
    });
  });
});
