import { Logger } from '@nestjs/common';

interface CacheEntry {
  value: string;
  expiresAt?: number;
}

export class InMemoryRedisClient {
  private readonly logger = new Logger(InMemoryRedisClient.name);
  private readonly store = new Map<string, CacheEntry>();
  public status = 'ready';

  constructor() {
    this.logger.log('🚀 Initialized InMemoryRedisClient (Zero-setup / Local fallback)');
  }

  private isExpired(entry: CacheEntry): boolean {
    if (!entry.expiresAt) return false;
    return Date.now() > entry.expiresAt;
  }

  private cleanIfExpired(key: string): CacheEntry | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (this.isExpired(entry)) {
      this.store.delete(key);
      return undefined;
    }
    return entry;
  }

  async get(key: string): Promise<string | null> {
    const entry = this.cleanIfExpired(key);
    return entry ? entry.value : null;
  }

  async set(key: string, value: string, ...args: any[]): Promise<'OK' | null> {
    let ttlMs: number | undefined;
    let onlyIfNotExist = false;

    for (let i = 0; i < args.length; i++) {
      const arg = String(args[i]).toUpperCase();
      if (arg === 'EX' && args[i + 1] !== undefined) {
        ttlMs = Number(args[i + 1]) * 1000;
        i++;
      } else if (arg === 'PX' && args[i + 1] !== undefined) {
        ttlMs = Number(args[i + 1]);
        i++;
      } else if (arg === 'NX') {
        onlyIfNotExist = true;
      }
    }

    if (onlyIfNotExist && this.cleanIfExpired(key)) {
      return null;
    }

    this.store.set(key, {
      value: String(value),
      expiresAt: ttlMs ? Date.now() + ttlMs : undefined,
    });
    return 'OK';
  }

  async del(...keys: string[]): Promise<number> {
    let deleted = 0;
    for (const key of keys) {
      if (this.store.delete(key)) deleted++;
    }
    return deleted;
  }

  async exists(...keys: string[]): Promise<number> {
    let count = 0;
    for (const key of keys) {
      if (this.cleanIfExpired(key)) count++;
    }
    return count;
  }

  async ping(): Promise<'PONG'> {
    return 'PONG';
  }

  async incr(key: string): Promise<number> {
    const entry = this.cleanIfExpired(key);
    const current = entry ? parseInt(entry.value, 10) || 0 : 0;
    const next = current + 1;
    this.store.set(key, {
      value: String(next),
      expiresAt: entry?.expiresAt,
    });
    return next;
  }

  async expire(key: string, seconds: number): Promise<number> {
    const entry = this.cleanIfExpired(key);
    if (!entry) return 0;
    entry.expiresAt = Date.now() + seconds * 1000;
    return 1;
  }

  async eval(script: string, numkeys: number, ...args: (string | number)[]): Promise<any> {
    const keys = args.slice(0, numkeys).map(String);
    const argv = args.slice(numkeys).map(String);

    // Circuit Breaker simulation for InMemory
    if (script.includes("redis.call('INCR', KEYS[1])")) {
      const total = await this.incr(keys[0]);
      if (total === 1 && argv[0]) {
        await this.expire(keys[0], Number(argv[0]));
      }

      const isFailure = argv[1] === '1';
      if (isFailure && keys[1]) {
        const failures = await this.incr(keys[1]);
        if (failures === 1 && argv[0]) {
          await this.expire(keys[1], Number(argv[0]));
        }

        const minRequests = Number(argv[2]);
        const failureThreshold = Number(argv[3]);
        if (total >= minRequests && (failures * 100) / total >= failureThreshold) {
          if (keys[2]) await this.set(keys[2], 'open');
          if (keys[3]) await this.set(keys[3], argv[4]);
          await this.del(keys[0], keys[1]);
          return 'open';
        }
      }
      return 'closed';
    }

    return null;
  }

  on(event: string, callback: (...args: any[]) => void): this {
    if (event === 'connect' || event === 'ready') {
      setTimeout(() => callback(), 0);
    }
    return this;
  }

  disconnect(): void {
    this.store.clear();
  }

  quit(): Promise<'OK'> {
    this.store.clear();
    return Promise.resolve('OK');
  }
}
