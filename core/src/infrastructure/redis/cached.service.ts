import { Inject, Injectable, Logger } from '@nestjs/common';
import Redis from 'ioredis';

export type TtlValue = number;

@Injectable()
export class CachedService {
  private readonly logger = new Logger(CachedService.name);
  private readonly inFlightRequests = new Map<string, Promise<any>>();
  private readonly NULLABLE_SENTINEL = ' __CACHED_NULL__ ';

  constructor(
    @Inject('REDIS_CLIENT')
    private readonly redis: Redis,
  ) {}

  async exists(key: string): Promise<boolean> {
    try {
      return (await this.redis.exists(key)) === 1;
    } catch (error) {
      this.logger.error(`Redis exists error: ${(error as Error).message}`);
      return false;
    }
  }

  // Health-check liveness — không cần key nào, chỉ cần Redis phản hồi được.
  async ping(): Promise<boolean> {
    try {
      return (await this.redis.ping()) === 'PONG';
    } catch (error) {
      this.logger.error(`Redis ping error: ${(error as Error).message}`);
      return false;
    }
  }

  // Thêm độ lệch ngẫu nhiên vào TTL để chống sập đồng loạt (Cache stampede / expiration storm)
  withJitter(ttl: number, percent = 0.1): number {
    const delta = ttl * percent;
    const jitter = Math.floor(Math.random() * delta);
    return ttl + jitter;
  }

  private serialize(value: any): string {
    return typeof value === 'string' ? value : JSON.stringify(value);
  }

  private deserialize<T>(data: string | null): T | null {
    if (!data) return null;
    try {
      return JSON.parse(data) as T;
    } catch {
      return data as unknown as T;
    }
  }

  // Base cache operations

  async get<T>(key: string): Promise<T | null> {
    try {
      const data = await this.redis.get(key);
      return this.deserialize<T>(data);
    } catch (error) {
      this.logger.error(
        `Redis get error for key ${key}: ${(error as Error).message}`,
      );
      return null;
    }
  }

  async set(
    key: string,
    value: any,
    ttlSeconds?: number,
    applyJitter = false,
  ): Promise<boolean> {
    try {
      const serialized = this.serialize(value);
      if (ttlSeconds) {
        const finalTtl = applyJitter ? this.withJitter(ttlSeconds) : ttlSeconds;
        await this.redis.set(key, serialized, 'EX', finalTtl);
      } else {
        await this.redis.set(key, serialized);
      }
      return true;
    } catch (error) {
      this.logger.error(
        `Redis set error for key ${key}: ${(error as Error).message}`,
      );
      return false;
    }
  }

  async del(key: string): Promise<boolean> {
    try {
      await this.redis.del(key);
      return true;
    } catch (error) {
      this.logger.error(
        `Redis del error for key ${key}: ${(error as Error).message}`,
      );
      return false;
    }
  }

  // Tracker (version tracking cho invalidate danh sách không cần KEYS *)

  async getVersion(trackerKey: string): Promise<number> {
    try {
      const version = await this.redis.get(trackerKey);
      return version ? Number(version) : 0;
    } catch (error) {
      this.logger.error(
        `Redis getVersion error for key ${trackerKey}: ${(error as Error).message}`,
      );
      return 0;
    }
  }

  async bumpVersion(trackerKey: string): Promise<number> {
    try {
      return await this.redis.incr(trackerKey);
    } catch (error) {
      this.logger.error(
        `Redis bumpVersion error for key ${trackerKey}: ${(error as Error).message}`,
      );
      return 0;
    }
  }

  // Singleflight Detail Cache: Nếu nhiều request cùng hỏi 1 key, chỉ 1 request chạy fetcher,
  // các request khác chia sẻ Promise đang chạy để triệt tiêu Cache Stampede / Thundering Herd.

  async getOrSetDetail<T>(
    key: string,
    ttl: TtlValue,
    fetcher: () => Promise<T>,
  ): Promise<T> {
    const cached = await this.get<T>(key);
    if (cached !== null) return cached;

    if (this.inFlightRequests.has(key)) {
      this.logger.debug(
        `Singleflight: Đang chờ in-flight request cho key: ${key}`,
      );
      return this.inFlightRequests.get(key) as Promise<T>;
    }

    const fetchPromise = fetcher()
      .then(async (data) => {
        if (data !== undefined && data !== null) {
          await this.set(key, data, ttl, true);
        }
        this.inFlightRequests.delete(key);
        return data;
      })
      .catch((err) => {
        this.inFlightRequests.delete(key);
        throw err;
      });

    this.inFlightRequests.set(key, fetchPromise);
    return fetchPromise;
  }

  async invalidateDetail(key: string): Promise<boolean> {
    return this.del(key);
  }

  // Negative Caching với Sentinel: Cache cả trường hợp fetcher trả về null (bản ghi không tồn tại)
  // để ngăn chặn Agent spam query CSDL liên tục.

  async getOrSetDetailNullable<T>(
    key: string,
    ttl: TtlValue,
    fetcher: () => Promise<T | null>,
  ): Promise<T | null> {
    const cached = await this.get<T | string>(key);
    if (cached !== null) {
      return cached === this.NULLABLE_SENTINEL ? null : (cached as T);
    }

    if (this.inFlightRequests.has(key)) {
      this.logger.debug(
        `Singleflight: Đang chờ in-flight request cho key: ${key}`,
      );
      return this.inFlightRequests.get(key) as Promise<T | null>;
    }

    const fetchPromise = fetcher()
      .then(async (data) => {
        const toCache = data === null ? this.NULLABLE_SENTINEL : data;
        await this.set(key, toCache, ttl, true);
        this.inFlightRequests.delete(key);
        return data;
      })
      .catch((err) => {
        this.inFlightRequests.delete(key);
        throw err;
      });

    this.inFlightRequests.set(key, fetchPromise);
    return fetchPromise;
  }

  // List Cache: Quản lý cache danh sách phân trang kết hợp version tracker

  async getOrSetList<T>(options: {
    trackerKey: string;
    keyBuilder: (version: number) => string;
    ttl: TtlValue;
    fetcher: () => Promise<T>;
  }): Promise<T> {
    const { trackerKey, keyBuilder, ttl, fetcher } = options;
    const version = await this.getVersion(trackerKey);
    const key = keyBuilder(version);
    return this.getOrSetDetail(key, ttl, fetcher);
  }

  async invalidateList(trackerKey: string): Promise<number> {
    return this.bumpVersion(trackerKey);
  }
}
