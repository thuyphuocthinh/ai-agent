import { InMemoryIdempotencyStore } from './in-memory-idempotency.store';
import { EIdempotencyStatus } from '../constants/security.constants';

describe('InMemoryIdempotencyStore', () => {
  let store: InMemoryIdempotencyStore;

  beforeEach(() => {
    store = new InMemoryIdempotencyStore();
  });

  it('acquires lock successfully for a new key', async () => {
    const res = await store.acquire('order:102:u1', 60);
    expect(res.success).toBe(true);

    const record = await store.get('order:102:u1');
    expect(record?.status).toBe(EIdempotencyStatus.IN_PROGRESS);
  });

  it('rejects duplicate acquisition while IN_PROGRESS', async () => {
    await store.acquire('order:102:u1', 60);
    const secondAcquire = await store.acquire('order:102:u1', 60);

    expect(secondAcquire.success).toBe(false);
    expect(secondAcquire.reason).toBe(EIdempotencyStatus.IN_PROGRESS);
  });

  it('stores completed result and rejects duplicate acquisition after completion', async () => {
    await store.acquire('order:102:u1', 60);
    await store.complete('order:102:u1', { refundId: 'ref_999' });

    const thirdAcquire = await store.acquire('order:102:u1', 60);
    expect(thirdAcquire.success).toBe(false);
    expect(thirdAcquire.reason).toBe(EIdempotencyStatus.EXECUTED);
    expect(thirdAcquire.previousResult).toEqual({ refundId: 'ref_999' });
  });

  it('allows re-acquisition after key is released', async () => {
    await store.acquire('order:102:u1', 60);
    await store.release('order:102:u1');

    const retry = await store.acquire('order:102:u1', 60);
    expect(retry.success).toBe(true);
  });
});
