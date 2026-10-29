import { Inject, Injectable, Logger } from '@nestjs/common';
import Redis from 'ioredis';
import type { UIMessageChunk } from 'ai';
import { CACHE } from '../../constants/cache.constant';
import {
  AgentStreamContext,
  AgentStreamStep,
} from '../../contracts/streaming/stream-sink.interface';
import {
  ETurnLogEntryKind,
  ETurnLogStatus,
  ITurnEventLog,
  TurnLogEntry,
  TurnLogMeta,
  TurnLogStartDto,
} from '../../contracts/streaming/turn-event-log.interface';

const READ_BATCH = 200;
const BLOCK_MS = 2000;

type StreamReply = [string, [string, string[]][]][] | null;

/**
 * Event log theo turn trên Redis Streams (cần Redis thật, không chạy với client
 * in-memory). Chỉ 1 writer (worker đang chạy turn) nên thứ tự XADD chính là thứ
 * tự event; mọi lệnh ghi đi qua cùng 1 kết nối nên giữ nguyên thứ tự gọi.
 */
@Injectable()
export class RedisTurnEventLogService implements ITurnEventLog {
  private readonly logger = new Logger(RedisTurnEventLogService.name);
  private failureReported = false;

  constructor(
    @Inject('REDIS_CLIENT')
    private readonly redis: Redis,
  ) {}

  async start(dto: TurnLogStartDto): Promise<void> {
    const now = Date.now();
    const meta: TurnLogMeta = {
      ...dto,
      status: ETurnLogStatus.ACTIVE,
      startedAt: now,
      updatedAt: now,
    };
    const ttl = CACHE.ORCHESTRATION.SETTINGS.TURN_LOG_ACTIVE_TTL;
    const pipeline = this.redis
      .pipeline()
      .set(CACHE.ORCHESTRATION.KEYS.TURN_META(dto.messageId), JSON.stringify(meta), 'EX', ttl)
      .set(
        CACHE.ORCHESTRATION.KEYS.TURN_HEARTBEAT(dto.messageId),
        '1',
        'EX',
        CACHE.ORCHESTRATION.SETTINGS.TURN_HEARTBEAT_TTL,
      );
    if (dto.conversationId) {
      pipeline.set(
        CACHE.ORCHESTRATION.KEYS.TURN_ACTIVE(dto.conversationId),
        dto.messageId,
        'EX',
        ttl,
      );
    }
    await this.run(pipeline.exec());
  }

  // Không dùng async/await trước lệnh Redis: lệnh phải được gửi đồng bộ ngay lúc
  // gọi để thứ tự gọi = thứ tự trong log dù caller không await.
  appendStep(
    messageId: string,
    context: AgentStreamContext,
    step: AgentStreamStep,
  ): Promise<void> {
    return this.append(messageId, { k: ETurnLogEntryKind.STEP, context, step });
  }

  appendChunk(messageId: string, chunk: UIMessageChunk): Promise<void> {
    return this.append(messageId, { k: ETurnLogEntryKind.CHUNK, chunk });
  }

  async finish(messageId: string, status: ETurnLogStatus): Promise<void> {
    try {
      const existing = await this.getMeta(messageId);
      const now = Date.now();
      const meta: TurnLogMeta = {
        messageId,
        startedAt: now,
        ...existing,
        status,
        updatedAt: now,
      };
      const ttl = CACHE.ORCHESTRATION.SETTINGS.TURN_LOG_FINISHED_TTL;
      const pipeline = this.redis
        .pipeline()
        .set(CACHE.ORCHESTRATION.KEYS.TURN_META(messageId), JSON.stringify(meta), 'EX', ttl)
        .expire(CACHE.ORCHESTRATION.KEYS.TURN_LOG(messageId), ttl)
        .del(CACHE.ORCHESTRATION.KEYS.TURN_HEARTBEAT(messageId));

      if (meta.conversationId) {
        const activeKey = CACHE.ORCHESTRATION.KEYS.TURN_ACTIVE(meta.conversationId);
        if ((await this.redis.get(activeKey)) === messageId) {
          pipeline.del(activeKey);
        }
      }
      await this.run(pipeline.exec());
    } catch (error) {
      this.reportFailure(error);
    }
  }

  startHeartbeat(messageId: string): () => void {
    const settings = CACHE.ORCHESTRATION.SETTINGS;
    const key = CACHE.ORCHESTRATION.KEYS.TURN_HEARTBEAT(messageId);
    const timer = setInterval(() => {
      this.redis
        .set(key, '1', 'EX', settings.TURN_HEARTBEAT_TTL)
        .catch((error: unknown) => this.reportFailure(error));
    }, settings.TURN_HEARTBEAT_INTERVAL_MS);
    timer.unref?.();
    return () => clearInterval(timer);
  }

  async isAlive(messageId: string): Promise<boolean> {
    return (
      (await this.redis.exists(CACHE.ORCHESTRATION.KEYS.TURN_HEARTBEAT(messageId))) === 1
    );
  }

  async getMeta(messageId: string): Promise<TurnLogMeta | null> {
    const raw = await this.redis.get(CACHE.ORCHESTRATION.KEYS.TURN_META(messageId));
    if (!raw) return null;
    try {
      return JSON.parse(raw) as TurnLogMeta;
    } catch {
      return null;
    }
  }

  async findActiveTurnId(conversationId: string): Promise<string | null> {
    return this.redis.get(CACHE.ORCHESTRATION.KEYS.TURN_ACTIVE(conversationId));
  }

  async snapshot(messageId: string): Promise<TurnLogEntry[]> {
    const rows = await this.redis.xrange(
      CACHE.ORCHESTRATION.KEYS.TURN_LOG(messageId),
      '-',
      '+',
    );
    return rows
      .map(([id, fields]) => this.parse(id, fields))
      .filter((entry): entry is TurnLogEntry => entry !== null);
  }

  async *read(
    messageId: string,
    signal?: AbortSignal,
  ): AsyncGenerator<TurnLogEntry, void, undefined> {
    if (signal?.aborted) return;

    // XREAD BLOCK chiếm hẳn kết nối → mỗi phiên đọc dùng 1 kết nối riêng.
    const client = this.redis.duplicate();
    client.on('error', () => undefined);
    const onAbort = () => client.disconnect();
    signal?.addEventListener('abort', onAbort, { once: true });

    const key = CACHE.ORCHESTRATION.KEYS.TURN_LOG(messageId);
    let lastId = '0';
    let finalPass = false;
    try {
      while (!signal?.aborted) {
        const reply = (await (finalPass
          ? client.xread('COUNT', READ_BATCH, 'STREAMS', key, lastId)
          : client.xread(
              'COUNT',
              READ_BATCH,
              'BLOCK',
              BLOCK_MS,
              'STREAMS',
              key,
              lastId,
            ))) as StreamReply;

        const entries = reply?.[0]?.[1] ?? [];
        if (entries.length === 0) {
          if (finalPass) return;
          // Hết chờ mà chưa có event mới: nếu turn đã kết thúc, hoặc worker đã chết
          // (hết nhịp tim) thì đọc nốt 1 lần không chặn rồi dừng.
          const meta = await this.getMeta(messageId);
          if (
            !meta ||
            meta.status !== ETurnLogStatus.ACTIVE ||
            !(await this.isAlive(messageId))
          ) {
            finalPass = true;
          }
          continue;
        }

        for (const [id, fields] of entries) {
          lastId = id;
          const entry = this.parse(id, fields);
          if (entry) yield entry;
        }
      }
    } catch (error) {
      if (signal?.aborted) return;
      throw error;
    } finally {
      signal?.removeEventListener('abort', onAbort);
      client.disconnect();
    }
  }

  private append(messageId: string, payload: Record<string, unknown>): Promise<void> {
    const key = CACHE.ORCHESTRATION.KEYS.TURN_LOG(messageId);
    const settings = CACHE.ORCHESTRATION.SETTINGS;
    return this.run(
      this.redis
        .pipeline()
        .xadd(key, 'MAXLEN', '~', settings.TURN_LOG_MAXLEN, '*', 'd', JSON.stringify(payload))
        .expire(key, settings.TURN_LOG_ACTIVE_TTL)
        .exec(),
    );
  }

  private run(exec: Promise<[Error | null, unknown][] | null>): Promise<void> {
    return exec.then(
      (results) => {
        const failed = results?.find(([error]) => error);
        if (failed?.[0]) this.reportFailure(failed[0]);
      },
      (error: unknown) => this.reportFailure(error),
    );
  }

  private parse(id: string, fields: string[]): TurnLogEntry | null {
    const raw = fields[fields.indexOf('d') + 1];
    try {
      const data = JSON.parse(raw) as
        | { k: ETurnLogEntryKind.STEP; context: AgentStreamContext; step: AgentStreamStep }
        | { k: ETurnLogEntryKind.CHUNK; chunk: UIMessageChunk };
      return data.k === ETurnLogEntryKind.STEP
        ? { id, kind: ETurnLogEntryKind.STEP, context: data.context, step: data.step }
        : { id, kind: ETurnLogEntryKind.CHUNK, chunk: data.chunk };
    } catch {
      this.logger.warn(`Bỏ qua entry hỏng trong turn log id=${id}`);
      return null;
    }
  }

  // Ghi log hỏng không được làm hỏng turn: chỉ báo 1 lần (tránh spam mỗi token).
  private reportFailure(error: unknown): void {
    if (this.failureReported) return;
    this.failureReported = true;
    this.logger.error(
      `Turn event log không ghi được (cần Redis thật hỗ trợ Streams): ${(error as Error)?.message}`,
    );
  }
}
