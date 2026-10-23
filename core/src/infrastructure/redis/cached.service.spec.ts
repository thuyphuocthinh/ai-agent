import { CachedService } from './cached.service';
import { InMemoryRedisClient } from './in-memory-redis.client';
import Redis from 'ioredis';

describe('CachedService (Enterprise Caching)', () => {
  let redisClient: InMemoryRedisClient;
  let service: CachedService;

  beforeEach(() => {
    redisClient = new InMemoryRedisClient();
    service = new CachedService(redisClient as unknown as Redis);
  });

  afterEach(async () => {
    await redisClient.quit();
  });

  describe('Basic Operations', () => {
    it('sets and gets string and object values', async () => {
      await service.set('test:string', 'hello', 60);
      expect(await service.get<string>('test:string')).toBe('hello');

      const obj = { id: 1, name: 'Agent' };
      await service.set('test:object', obj, 60);
      expect(await service.get<typeof obj>('test:object')).toEqual(obj);
    });

    it('returns null for missing key', async () => {
      expect(await service.get('missing:key')).toBeNull();
    });

    it('checks existence and deletion of keys', async () => {
      await service.set('test:exists', 'val', 60);
      expect(await service.exists('test:exists')).toBe(true);
      await service.del('test:exists');
      expect(await service.exists('test:exists')).toBe(false);
    });

    it('pings redis successfully', async () => {
      expect(await service.ping()).toBe(true);
    });
  });

  describe('withJitter (TTL Jitter)', () => {
    it('adds jitter within expected percent range', () => {
      const ttl = 1000;
      for (let i = 0; i < 20; i++) {
        const jittered = service.withJitter(ttl, 0.1);
        expect(jittered).toBeGreaterThanOrEqual(1000);
        expect(jittered).toBeLessThanOrEqual(1100);
      }
    });
  });

  describe('Singleflight (Thundering Herd Protection)', () => {
    it('coalesces multiple concurrent fetches into a single execution', async () => {
      const fetcher = jest.fn().mockImplementation(async () => {
        await new Promise((resolve) => setTimeout(resolve, 30));
        return { data: 'expensive-result' };
      });

      // Call 5 times concurrently for the same key
      const results = await Promise.all([
        service.getOrSetDetail('sf:key', 60, fetcher),
        service.getOrSetDetail('sf:key', 60, fetcher),
        service.getOrSetDetail('sf:key', 60, fetcher),
        service.getOrSetDetail('sf:key', 60, fetcher),
        service.getOrSetDetail('sf:key', 60, fetcher),
      ]);

      expect(fetcher).toHaveBeenCalledTimes(1);
      results.forEach((res) => {
        expect(res).toEqual({ data: 'expensive-result' });
      });

      // Subsequent call should get from cache without calling fetcher again
      const cached = await service.getOrSetDetail('sf:key', 60, fetcher);
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(cached).toEqual({ data: 'expensive-result' });
    });
  });

  describe('Negative Caching (getOrSetDetailNullable)', () => {
    it('caches null values with sentinel to avoid repeated database hits', async () => {
      const fetcher = jest.fn().mockResolvedValue(null);

      const first = await service.getOrSetDetailNullable('null:key', 60, fetcher);
      expect(first).toBeNull();
      expect(fetcher).toHaveBeenCalledTimes(1);

      // Second call returns null from cache without invoking fetcher
      const second = await service.getOrSetDetailNullable('null:key', 60, fetcher);
      expect(second).toBeNull();
      expect(fetcher).toHaveBeenCalledTimes(1);
    });
  });

  describe('Version-based List Tracking', () => {
    it('tracks versions and invalidates lists via bumpVersion', async () => {
      const trackerKey = 'trackers:test:list_version';
      let callCount = 0;
      const fetcher = async () => ({ items: [`item-${++callCount}`] });

      const res1 = await service.getOrSetList({
        trackerKey,
        keyBuilder: (ver) => `test:list:v${ver}`,
        ttl: 60,
        fetcher,
      });
      expect(res1.items).toEqual(['item-1']);

      // Repeated call returns cached version
      const res2 = await service.getOrSetList({
        trackerKey,
        keyBuilder: (ver) => `test:list:v${ver}`,
        ttl: 60,
        fetcher,
      });
      expect(res2.items).toEqual(['item-1']);

      // Invalidate list via tracker bump
      await service.invalidateList(trackerKey);

      // Next call fetches new version
      const res3 = await service.getOrSetList({
        trackerKey,
        keyBuilder: (ver) => `test:list:v${ver}`,
        ttl: 60,
        fetcher,
      });
      expect(res3.items).toEqual(['item-2']);
    });
  });
});
