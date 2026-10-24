import { Injectable } from '@nestjs/common';
import {
  AcquireResult,
  IdempotencyRecord,
  IIdempotencyStore,
} from '../contracts/idempotency-store.interface';
import { EIdempotencyStatus } from '../constants/security.constants';

@Injectable()
export class InMemoryIdempotencyStore implements IIdempotencyStore {
  private readonly cache = new Map<string, IdempotencyRecord>();

  async acquire(key: string, ttlSeconds: number): Promise<AcquireResult> {
    this.cleanExpired();
    const record = this.cache.get(key);
    const now = Date.now();

    if (record) {
      if (record.status === EIdempotencyStatus.EXECUTED) {
        return {
          success: false,
          reason: EIdempotencyStatus.EXECUTED,
          previousResult: record.result,
        };
      }

      if (
        record.status === EIdempotencyStatus.IN_PROGRESS &&
        record.expiresAt > now
      ) {
        return {
          success: false,
          reason: EIdempotencyStatus.IN_PROGRESS,
        };
      }
    }

    this.cache.set(key, {
      status: EIdempotencyStatus.IN_PROGRESS,
      createdAt: now,
      expiresAt: now + ttlSeconds * 1000,
    });

    return { success: true };
  }

  async complete(
    key: string,
    result?: unknown,
    retainSeconds = 300,
  ): Promise<void> {
    const now = Date.now();
    this.cache.set(key, {
      status: EIdempotencyStatus.EXECUTED,
      createdAt: now,
      expiresAt: now + retainSeconds * 1000,
      result,
    });
  }

  async release(key: string): Promise<void> {
    this.cache.delete(key);
  }

  async get(key: string): Promise<IdempotencyRecord | null> {
    this.cleanExpired();
    return this.cache.get(key) ?? null;
  }

  private cleanExpired(): void {
    const now = Date.now();
    for (const [key, record] of this.cache.entries()) {
      if (record.expiresAt <= now) {
        this.cache.delete(key);
      }
    }
  }
}
