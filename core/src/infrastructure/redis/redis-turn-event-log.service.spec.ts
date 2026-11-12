import Redis from 'ioredis';
import { randomUUID } from 'crypto';
import { EAgentStreamStepType } from '@agent/core/constants';
import { CACHE } from '../../constants/cache.constant';
import {
  ETurnLogEntryKind,
  ETurnLogStatus,
  TurnLogEntry,
} from '../../contracts/streaming/turn-event-log.interface';
import { RedisTurnEventLogService } from './redis-turn-event-log.service';

// Cần Redis thật (Streams). Đặt SKIP_REDIS_TESTS=1 để bỏ qua khi không có Redis.
const describeWithRedis = process.env.SKIP_REDIS_TESTS ? describe.skip : describe;

describeWithRedis('RedisTurnEventLogService (Redis Streams thật)', () => {
  let redis: Redis;
  let log: RedisTurnEventLogService;
  const usedIds: string[] = [];

  const newTurn = (): { messageId: string; conversationId: string } => {
    const messageId = `test-${randomUUID()}`;
    usedIds.push(messageId);
    return { messageId, conversationId: `conv-${messageId}` };
  };

  const step = (text: string) => ({
    type: EAgentStreamStepType.TOKEN as const,
    text,
  });

  const collect = async (
    iterable: AsyncGenerator<TurnLogEntry, void, undefined>,
    stopAfter?: number,
  ): Promise<TurnLogEntry[]> => {
    const out: TurnLogEntry[] = [];
    for await (const entry of iterable) {
      out.push(entry);
      if (stopAfter !== undefined && out.length >= stopAfter) break;
    }
    return out;
  };

  const texts = (entries: TurnLogEntry[]): string[] =>
    entries.map((e) => (e.kind === ETurnLogEntryKind.STEP ? (e.step.text ?? e.step.type) : 'chunk'));

  beforeAll(() => {
    redis = new Redis({
      host: process.env.REDIS_HOST ?? 'localhost',
      port: Number(process.env.REDIS_PORT ?? 6379),
      password: process.env.REDIS_PASSWORD || undefined,
      username: process.env.REDIS_USERNAME || undefined,
    });
    log = new RedisTurnEventLogService(redis);
  });

  afterEach(async () => {
    for (const id of usedIds.splice(0)) {
      await redis.del(
        CACHE.ORCHESTRATION.KEYS.TURN_LOG(id),
        CACHE.ORCHESTRATION.KEYS.TURN_META(id),
        CACHE.ORCHESTRATION.KEYS.TURN_ACTIVE(`conv-${id}`),
      );
    }
  });

  afterAll(async () => {
    await redis.quit();
  });

  it('start đánh dấu turn ACTIVE và tìm được theo conversation', async () => {
    const { messageId, conversationId } = newTurn();
    await log.start({ messageId, conversationId, userId: 'u1' });

    const meta = await log.getMeta(messageId);
    expect(meta).toMatchObject({ messageId, conversationId, userId: 'u1', status: ETurnLogStatus.ACTIVE });
    expect(await log.findActiveTurnId(conversationId)).toBe(messageId);
  });

  it('finish chốt trạng thái, đặt TTL ngắn và gỡ con trỏ active', async () => {
    const { messageId, conversationId } = newTurn();
    await log.start({ messageId, conversationId });
    await log.appendStep(messageId, { userId: 'u1', messageId }, step('a'));
    await log.finish(messageId, ETurnLogStatus.PAUSED);

    expect((await log.getMeta(messageId))?.status).toBe(ETurnLogStatus.PAUSED);
    expect(await log.findActiveTurnId(conversationId)).toBeNull();
    const ttl = await redis.ttl(CACHE.ORCHESTRATION.KEYS.TURN_LOG(messageId));
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(CACHE.ORCHESTRATION.SETTINGS.TURN_LOG_FINISHED_TTL);
  });

  it('read phát lại từ ĐẦU đúng thứ tự, gồm cả step lẫn chunk, rồi dừng khi turn đã xong', async () => {
    const { messageId, conversationId } = newTurn();
    await log.start({ messageId, conversationId });
    const context = { userId: 'u1', messageId };
    await log.appendStep(messageId, context, step('một'));
    await log.appendChunk(messageId, { type: 'data-reply', data: { text: 'đáp án' } } as never);
    await log.appendStep(messageId, context, step('hai'));
    await log.finish(messageId, ETurnLogStatus.DONE);

    const entries = await collect(log.read(messageId));

    expect(texts(entries)).toEqual(['một', 'chunk', 'hai']);
    expect(entries[1]).toMatchObject({ kind: ETurnLogEntryKind.CHUNK, chunk: { type: 'data-reply' } });
  });

  it('giữ đúng thứ tự gọi khi nhiều append chạy đồng thời không await', async () => {
    const { messageId, conversationId } = newTurn();
    await log.start({ messageId, conversationId });
    const context = { userId: 'u1', messageId };

    const expected = Array.from({ length: 300 }, (_, i) => `t${i}`);
    const pending = expected.map((t) => log.appendStep(messageId, context, step(t)));
    await Promise.all(pending);
    await log.finish(messageId, ETurnLogStatus.DONE);

    expect(texts(await collect(log.read(messageId)))).toEqual(expected);
  });

  it('đọc từ đầu rồi bám đuôi: nhận đủ event ghi SAU khi reader đã chạy, không trùng, tự dừng khi xong', async () => {
    const { messageId, conversationId } = newTurn();
    await log.start({ messageId, conversationId });
    const context = { userId: 'u1', messageId };
    await log.appendStep(messageId, context, step('cũ-1'));
    await log.appendStep(messageId, context, step('cũ-2'));

    const reading = collect(log.read(messageId));
    await new Promise((r) => setTimeout(r, 150));
    await log.appendStep(messageId, context, step('mới-1'));
    await new Promise((r) => setTimeout(r, 100));
    await log.appendStep(messageId, context, step('mới-2'));
    await log.finish(messageId, ETurnLogStatus.DONE);

    expect(texts(await reading)).toEqual(['cũ-1', 'cũ-2', 'mới-1', 'mới-2']);
  });

  it('reload giữa chừng: reader mới đọc lại từ đầu thấy trọn vẹn những gì reader cũ đã thấy và cả phần sau', async () => {
    const { messageId, conversationId } = newTurn();
    await log.start({ messageId, conversationId });
    const context = { userId: 'u1', messageId };
    const all = ['a', 'b', 'c', 'd', 'e'];
    for (const t of all.slice(0, 3)) await log.appendStep(messageId, context, step(t));

    const firstReader = await collect(log.read(messageId), 2);
    expect(texts(firstReader)).toEqual(['a', 'b']);

    for (const t of all.slice(3)) await log.appendStep(messageId, context, step(t));
    await log.finish(messageId, ETurnLogStatus.DONE);

    expect(texts(await collect(log.read(messageId)))).toEqual(all);
  }, 15000);

  it('abort signal dừng reader đang chờ ngay lập tức', async () => {
    const { messageId, conversationId } = newTurn();
    await log.start({ messageId, conversationId });
    const controller = new AbortController();

    const startedAt = Date.now();
    const reading = collect(log.read(messageId, controller.signal));
    setTimeout(() => controller.abort(), 100);

    expect(await reading).toEqual([]);
    expect(Date.now() - startedAt).toBeLessThan(1500);
  });

  it('turn đã kết thúc mà log không có event nào thì reader trả rỗng rồi dừng (không treo)', async () => {
    const { messageId, conversationId } = newTurn();
    await log.start({ messageId, conversationId });
    await log.finish(messageId, ETurnLogStatus.FAILED);

    expect(await collect(log.read(messageId))).toEqual([]);
  });
  it('start đặt nhịp tim; finish gỡ nhịp tim', async () => {
    const { messageId, conversationId } = newTurn();
    await log.start({ messageId, conversationId });
    expect(await log.isAlive(messageId)).toBe(true);

    await log.finish(messageId, ETurnLogStatus.DONE);
    expect(await log.isAlive(messageId)).toBe(false);
  });

  it('startHeartbeat trả hàm dừng và không ném lỗi', async () => {
    const { messageId } = newTurn();
    const stop = log.startHeartbeat(messageId);

    expect(typeof stop).toBe('function');
    expect(() => stop()).not.toThrow();
  });

  it('worker chết (hết nhịp tim mà turn vẫn ACTIVE): reader đọc nốt phần đã có rồi tự dừng, không treo', async () => {
    const { messageId, conversationId } = newTurn();
    await log.start({ messageId, conversationId });
    const context = { userId: 'u1', messageId };
    await log.appendStep(messageId, context, step('đã có 1'));
    await log.appendStep(messageId, context, step('đã có 2'));
    await redis.del(CACHE.ORCHESTRATION.KEYS.TURN_HEARTBEAT(messageId));

    const startedAt = Date.now();
    const entries = await collect(log.read(messageId));

    expect(texts(entries)).toEqual(['đã có 1', 'đã có 2']);
    expect(Date.now() - startedAt).toBeLessThan(8000);
  });

  it('còn nhịp tim thì reader tiếp tục chờ (không dừng sớm khi chỉ im lặng lâu)', async () => {
    const { messageId, conversationId } = newTurn();
    await log.start({ messageId, conversationId });
    const context = { userId: 'u1', messageId };

    const reading = collect(log.read(messageId));
    // im lặng lâu hơn 1 chu kỳ BLOCK (2s) nhưng worker vẫn sống
    await new Promise((resolve) => setTimeout(resolve, 2600));
    await log.appendStep(messageId, context, step('muộn'));
    await log.finish(messageId, ETurnLogStatus.DONE);

    expect(texts(await reading)).toEqual(['muộn']);
  }, 15000);

});
