import { ETurnLogEntryKind, TurnLogEntry } from './turn-event-log.interface';
import { reduceTurnLog } from './turn-log-reducer';

const step = (
  step: Record<string, unknown>,
  streamKey?: string,
  id = '1-0',
): TurnLogEntry =>
  ({
    id,
    kind: ETurnLogEntryKind.STEP,
    context: { userId: 'u', messageId: 'm', streamKey },
    step,
  }) as TurnLogEntry;

describe('reduceTurnLog', () => {
  it('trả rỗng cho log rỗng', () => {
    expect(reduceTurnLog([])).toEqual({ partialText: '', steps: [], toolCalls: [] });
  });

  it('nối token của stream mặc định, bỏ qua token của stream phụ (agent khác)', () => {
    const reduced = reduceTurnLog([
      step({ type: 'token', text: 'Xin ' }),
      step({ type: 'token', text: 'phụ' }, 'agent-2'),
      step({ type: 'token', text: 'chào' }),
    ]);

    expect(reduced.partialText).toBe('Xin chào');
  });

  it('resync của stream mặc định THAY text đã stream; của stream phụ thì bỏ qua', () => {
    const reduced = reduceTurnLog([
      step({ type: 'token', text: 'bản nháp' }),
      step({ type: 'resync', text: 'bản sửa' }),
      step({ type: 'resync', text: 'của agent phụ' }, 'agent-2'),
    ]);

    expect(reduced.partialText).toBe('bản sửa');
  });

  it('step_start tạo step với persona', () => {
    const reduced = reduceTurnLog([
      step({ type: 'step_start', label: 'Phân tích', persona: { role: 'Analyst', goal: 'g' } }),
      step({ type: 'step_start', label: 'Tổng hợp' }),
    ]);

    expect(reduced.steps).toEqual([
      { agent: 'Analyst', task: 'Phân tích', persona: { role: 'Analyst', goal: 'g' }, toolCalls: [] },
      { agent: 'Tổng hợp', task: 'Tổng hợp', persona: undefined, toolCalls: [] },
    ]);
  });

  it('ghép tool_result vào đúng tool_call theo toolCallId (gọi cùng tool nhiều lần)', () => {
    const reduced = reduceTurnLog([
      step({ type: 'tool_call', tool: 'sql.run', toolCallId: 'a', argsPreview: 'q1' }),
      step({ type: 'tool_call', tool: 'sql.run', toolCallId: 'b', argsPreview: 'q2' }),
      step({ type: 'tool_result', tool: 'sql.run', toolCallId: 'b', resultPreview: 'r2' }),
      step({ type: 'tool_result', tool: 'sql.run', toolCallId: 'a', resultPreview: 'r1' }),
    ]);

    expect(reduced.toolCalls).toEqual([
      expect.objectContaining({ toolCallId: 'a', argsPreview: 'q1', resultPreview: 'r1' }),
      expect.objectContaining({ toolCallId: 'b', argsPreview: 'q2', resultPreview: 'r2' }),
    ]);
  });

  it('không có toolCallId: kết quả ghép vào call gần nhất cùng tên chưa có kết quả', () => {
    const reduced = reduceTurnLog([
      step({ type: 'tool_call', tool: 'sql.run', argsPreview: 'q' }),
      step({ type: 'tool_result', tool: 'sql.run', resultPreview: 'r' }),
    ]);

    expect(reduced.toolCalls).toHaveLength(1);
    expect(reduced.toolCalls[0]).toMatchObject({ argsPreview: 'q', resultPreview: 'r' });
  });

  it('tool_result mồ côi vẫn được ghi nhận; bỏ qua entry chunk và step done', () => {
    const reduced = reduceTurnLog([
      step({ type: 'tool_result', tool: 'x.y', toolCallId: 'z', resultPreview: 'r' }),
      { id: '2-0', kind: ETurnLogEntryKind.CHUNK, chunk: { type: 'data-reply', data: { text: 't' } } } as TurnLogEntry,
      step({ type: 'done' }),
    ]);

    expect(reduced.toolCalls).toHaveLength(1);
    expect(reduced.partialText).toBe('');
  });
});
