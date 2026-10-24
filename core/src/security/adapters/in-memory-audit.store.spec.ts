import { InMemoryAuditStore } from './in-memory-audit.store';
import { AuditLogEntry } from '../security.interface';

describe('InMemoryAuditStore', () => {
  let store: InMemoryAuditStore;

  beforeEach(() => {
    store = new InMemoryAuditStore();
  });

  it('saves and retrieves audit entries by userId and entityId', async () => {
    const entry: AuditLogEntry = {
      id: 'log-1',
      timestamp: new Date(),
      userId: 'user-123',
      actionType: 'REFUND_ORDER',
      entityId: 'order-102',
      amount: 699_000,
      evaluationStatus: 'AUTO_APPROVED',
      reviewer: 'AI',
    };

    await store.save(entry);

    const userLogs = await store.findByUserId('user-123');
    expect(userLogs).toHaveLength(1);
    expect(userLogs[0].id).toBe('log-1');

    const entityLogs = await store.findByEntityId('order-102');
    expect(entityLogs).toHaveLength(1);
    expect(entityLogs[0].amount).toBe(699_000);

    const emptyLogs = await store.findByUserId('non-existent');
    expect(emptyLogs).toEqual([]);
  });

  it('returns recent logs with limit in reverse chronological order', async () => {
    for (let i = 1; i <= 5; i++) {
      await store.save({
        id: `log-${i}`,
        timestamp: new Date(Date.now() + i * 1000),
        userId: 'u1',
        actionType: 'TEST',
        evaluationStatus: 'OK',
        reviewer: 'AI',
      });
    }

    const recent = await store.getRecentLogs(3);
    expect(recent).toHaveLength(3);
    expect(recent[0].id).toBe('log-5');
    expect(recent[1].id).toBe('log-4');
    expect(recent[2].id).toBe('log-3');
  });
});
