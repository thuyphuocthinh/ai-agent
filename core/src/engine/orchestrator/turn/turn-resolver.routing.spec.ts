import { EExecutionEngineMode } from '../../../contracts';
import { TurnResolverService } from './turn-resolver.service';

// turn-resolver.service.ts kéo theo @agent/core/common (nanoid ESM-only) — mock như các spec khác.
jest.mock('@agent/core/common', () => ({ extractTextFromMcpResult: jest.fn() }));
jest.mock('uuid', () => ({ v4: jest.fn(() => 'test-uuid') }));

// Chỉ kiểm tra việc gắn `routing` (quyết định định tuyến lưu vào metadata để dựng lại
// card Supervisor sau reload); hành vi định tuyến/engine có spec riêng.
describe('TurnResolverService — gắn routing vào kết quả', () => {
  const data = {
    userId: 'user-1',
    channelId: 'channel-1',
    workspaceId: 'ws-1',
    messageId: 'trigger-1',
  } as never;

  const messageSink = {
    getMessageText: jest.fn().mockResolvedValue('prompt'),
    getRecentHistory: jest.fn().mockResolvedValue([]),
  };
  const supervisor = { getAvailableAgents: jest.fn().mockResolvedValue([]) };
  const memoryManager = { buildBudget: jest.fn().mockReturnValue({ historyCharBudget: 0 }) };
  const router = { route: jest.fn() };
  const engines = new Map<string, unknown>();
  const registry = { get: jest.fn((id: string) => engines.get(id)) };
  const workflowRegistry = { get: jest.fn() };
  const workflowRunner = { runWorkflow: jest.fn() };

  const build = (withWorkflow = false) =>
    new TurnResolverService(
      messageSink as never,
      supervisor as never,
      memoryManager as never,
      registry as never,
      router as never,
      withWorkflow ? (workflowRegistry as never) : undefined,
      withWorkflow ? (workflowRunner as never) : undefined,
    );

  beforeEach(() => {
    jest.clearAllMocks();
    engines.clear();
    messageSink.getMessageText.mockResolvedValue('prompt');
    messageSink.getRecentHistory.mockResolvedValue([]);
    supervisor.getAvailableAgents.mockResolvedValue([]);
  });

  it('engine xử lý turn → routing.mode = id của engine, giữ nguyên các field của câu trả lời', async () => {
    const answer = {
      content: 'xong',
      toolCalls: [{ tool: 'x.y', status: 'success' }],
      steps: [{ agent: 'a', task: 't', toolCalls: [] }],
    };
    engines.set(EExecutionEngineMode.AUTONOMOUS, {
      id: EExecutionEngineMode.AUTONOMOUS,
      execute: jest.fn().mockResolvedValue(answer),
    });
    router.route.mockReturnValue({ mode: EExecutionEngineMode.AUTONOMOUS, engineId: EExecutionEngineMode.AUTONOMOUS, reason: 'r' });

    const result = await build().resolveAnswer(data, 'reply-1');

    expect(result).toEqual({ ...answer, routing: { mode: 'autonomous' } });
  });

  it('engine được chọn không tồn tại → ném lỗi rõ ràng, không fallback im lặng', async () => {
    router.route.mockReturnValue({ mode: 'engine_khong_ton_tai', engineId: 'engine_khong_ton_tai', reason: 'r' });

    await expect(build().resolveAnswer(data, 'reply-1')).rejects.toThrow(
      'Không tìm thấy engine "engine_khong_ton_tai"',
    );
  });

  it('fixed workflow → định tuyến qua Deterministic Engine', async () => {
    engines.set(EExecutionEngineMode.DETERMINISTIC, {
      id: EExecutionEngineMode.DETERMINISTIC,
      execute: jest.fn().mockResolvedValue({ content: 'xong workflow' }),
    });
    router.route.mockReturnValue({
      mode: EExecutionEngineMode.DETERMINISTIC,
      engineId: EExecutionEngineMode.DETERMINISTIC,
      reason: 'Kịch bản định sẵn',
    });

    const result = await build().resolveAnswer(
      { ...(data as object), workflowId: 'wf-1' } as never,
      'reply-1',
    );

    expect(result).toEqual({
      content: 'xong workflow',
      routing: { mode: 'deterministic' },
    });
  });
});
