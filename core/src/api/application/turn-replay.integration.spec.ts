import Redis from 'ioredis';
import { randomUUID } from 'crypto';
import { readUIMessageStream } from 'ai';
import type { UIMessage, UIMessageChunk } from 'ai';
import { CACHE } from '../../constants/cache.constant';
import { AgentStreamService } from '../../engine/streaming/agent-stream.service';
import { MessageClientService } from '../../engine/streaming/message-client.service';
import { ETurnLogStatus, IChatSession } from '../../contracts';
import { RedisTurnEventLogService } from '../../infrastructure/redis/redis-turn-event-log.service';
import { TurnStreamFactory } from './turn-stream.factory';

// Đường thật, không giả lập: AgentStreamService ghi event log lên Redis Streams thật,
// reload giữa chừng = TurnStreamFactory.createReplayTurn phát lại từ log.
// Đặt SKIP_REDIS_TESTS=1 để bỏ qua khi không có Redis.
const describeWithRedis = process.env.SKIP_REDIS_TESTS ? describe.skip : describe;

describeWithRedis('Reload giữa chừng khi đang stream (Redis Streams thật)', () => {
  let redis: Redis;
  let log: RedisTurnEventLogService;
  let agentStream: AgentStreamService;
  let factory: TurnStreamFactory;
  const used: string[] = [];

  const session = {
    id: 'session-1',
    userId: 'user-1',
    conversationId: 'conv-1',
    approvalMessageIds: new Set<string>(),
  } as unknown as IChatSession;

  const readAll = async (stream: ReadableStream<UIMessageChunk>) => {
    const chunks: UIMessageChunk[] = [];
    const reader = stream.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
    }
    return chunks;
  };

  const toMessage = async (chunks: UIMessageChunk[]): Promise<UIMessage> => {
    const stream = new ReadableStream<UIMessageChunk>({
      start(controller) {
        chunks.forEach((chunk) => controller.enqueue(chunk));
        controller.close();
      },
    });
    let last: UIMessage | undefined;
    for await (const message of readUIMessageStream({ stream })) last = message;
    return last as UIMessage;
  };

  const textOf = (message: UIMessage): string =>
    message.parts
      .filter((part) => part.type === 'text')
      .map((part) => (part as { text: string }).text)
      .join('');

  beforeAll(() => {
    redis = new Redis({
      host: process.env.REDIS_HOST ?? 'localhost',
      port: Number(process.env.REDIS_PORT ?? 6379),
      password: process.env.REDIS_PASSWORD || undefined,
      username: process.env.REDIS_USERNAME || undefined,
    });
    log = new RedisTurnEventLogService(redis);
    agentStream = new AgentStreamService(undefined, log);
    factory = new TurnStreamFactory(
      agentStream,
      new MessageClientService(),
      { requestCancel: jest.fn() } as never,
      undefined,
      log,
    );
  });

  afterEach(async () => {
    await agentStream.flush();
    for (const id of used.splice(0)) {
      await redis.del(
        CACHE.ORCHESTRATION.KEYS.TURN_LOG(id),
        CACHE.ORCHESTRATION.KEYS.TURN_META(id),
        CACHE.ORCHESTRATION.KEYS.TURN_HEARTBEAT(id),
        CACHE.ORCHESTRATION.KEYS.TURN_ACTIVE('conv-1'),
      );
    }
  });

  afterAll(async () => {
    await redis.quit();
  });

  it('F5 giữa lúc đang stream: replay thấy đủ persona + tool + text đã stream và nhận tiếp phần còn lại tới finish', async () => {
    const messageId = `it-${randomUUID()}`;
    used.push(messageId);
    const ctx = { userId: 'user-1', channelId: 'conv-1', messageId };
    await log.start({ messageId, conversationId: 'conv-1', userId: 'user-1' });

    // --- trước khi reload: engine đã stream được một phần ---
    await agentStream.emitStep(ctx, {
      type: 'step_start',
      label: 'Phân tích',
      persona: { role: 'Analyst', goal: 'g' },
    });
    await agentStream.emitStep(ctx, {
      type: 'tool_call',
      tool: 'sql.run',
      toolCallId: 'tc-1',
      argsPreview: '{"q":1}',
    });
    await agentStream.emitStep(ctx, {
      type: 'tool_result',
      tool: 'sql.run',
      toolCallId: 'tc-1',
      resultPreview: 'ok',
    });
    await agentStream.emitToken(ctx, 'Xin ');
    await agentStream.emitToken(ctx, 'chào ');
    await agentStream.flush();

    // --- F5: kết nối mới phát lại từ đầu ---
    const reconnected = factory.createReplayTurn(session, messageId);
    const collecting = readAll(reconnected.stream);

    // --- engine vẫn chạy ngầm, tiếp tục stream sau khi client đã reconnect ---
    await new Promise((resolve) => setTimeout(resolve, 150));
    await agentStream.emitToken(ctx, 'bạn');
    await agentStream.flush();
    await agentStream.emitStep(ctx, { type: 'done' });
    await log.finish(messageId, ETurnLogStatus.DONE);

    const chunks = await collecting;
    const message = await toMessage(chunks);

    expect(chunks.at(-1)).toMatchObject({ type: 'finish' });
    expect(textOf(message)).toBe('Xin chào bạn');
    const types = chunks.map((chunk) => chunk.type as string);
    expect(types).toContain('data-persona');
    expect(types).toContain('tool-input-available');
    expect(types).toContain('tool-output-available');
    // tool chỉ xuất hiện đúng 1 lần (không lặp do replay)
    expect(types.filter((type) => type === 'tool-input-available')).toHaveLength(1);
  });

  it('reload nhiều lần liên tiếp đều ra cùng một kết quả đầy đủ khi turn đã kết thúc', async () => {
    const messageId = `it-${randomUUID()}`;
    used.push(messageId);
    const ctx = { userId: 'user-1', channelId: 'conv-1', messageId };
    await log.start({ messageId, conversationId: 'conv-1', userId: 'user-1' });
    await agentStream.emitToken(ctx, 'Đáp án đầy đủ');
    await agentStream.flush();
    await agentStream.emitStep(ctx, { type: 'done' });
    await log.finish(messageId, ETurnLogStatus.DONE);

    const first = await readAll(factory.createReplayTurn(session, messageId).stream);
    const second = await readAll(factory.createReplayTurn(session, messageId).stream);

    expect(second).toEqual(first);
    expect(textOf(await toMessage(first))).toBe('Đáp án đầy đủ');
  });

  it('đóng kết nối reconnect không làm hỏng log: kết nối sau vẫn đọc được đủ', async () => {
    const messageId = `it-${randomUUID()}`;
    used.push(messageId);
    const ctx = { userId: 'user-1', channelId: 'conv-1', messageId };
    await log.start({ messageId, conversationId: 'conv-1', userId: 'user-1' });
    await agentStream.emitToken(ctx, 'một ');
    await agentStream.flush();

    const dropped = factory.createReplayTurn(session, messageId);
    const reader = dropped.stream.getReader();
    await reader.read();
    dropped.close();

    await agentStream.emitToken(ctx, 'hai');
    await agentStream.flush();
    await agentStream.emitStep(ctx, { type: 'done' });
    await log.finish(messageId, ETurnLogStatus.DONE);

    const chunks = await readAll(factory.createReplayTurn(session, messageId).stream);
    expect(textOf(await toMessage(chunks))).toBe('một hai');
  });
});
