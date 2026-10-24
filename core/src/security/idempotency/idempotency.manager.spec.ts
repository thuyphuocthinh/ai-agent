import { IdempotencyManager } from './idempotency.manager';
import { InMemoryIdempotencyStore } from '../adapters/in-memory-idempotency.store';
import {
  EIdempotencyStatus,
  EActionType,
} from '../constants/security.constants';

describe('IdempotencyManager', () => {
  let manager: IdempotencyManager;
  let store: InMemoryIdempotencyStore;

  beforeEach(() => {
    store = new InMemoryIdempotencyStore();
    manager = new IdempotencyManager(store);
  });

  describe('generateToolFingerprint', () => {
    it('generates consistent 64-char SHA-256 hash regardless of argument key order', () => {
      const fp1 = manager.generateToolFingerprint({
        userId: 'user-42',
        provider: 'devops_git',
        toolName: 'merge_pull_request',
        args: { prId: 105, repo: 'infra-k8s', squash: true },
      });

      const fp2 = manager.generateToolFingerprint({
        userId: 'user-42',
        provider: 'devops_git',
        toolName: 'merge_pull_request',
        args: { squash: true, repo: 'infra-k8s', prId: 105 },
      });

      expect(fp1).toHaveLength(64);
      expect(fp1).toBe(fp2);
    });
  });

  describe('acquireForTool & complete workflow', () => {
    it('successfully acquires for initial call and blocks duplicate call with scrambled parameters', async () => {
      const initialCall = {
        userId: 'user-finance',
        provider: 'stripe',
        toolName: 'create_refund',
        args: { chargeId: 'ch_998', amount: 50000 },
      };

      const firstAttempt = await manager.acquireForTool(initialCall);
      expect(firstAttempt.success).toBe(true);
      expect(firstAttempt.fingerprint).toHaveLength(64);

      // Concurrent or duplicate call with different parameter key order
      const duplicateCall = {
        userId: 'user-finance',
        provider: 'stripe',
        toolName: 'create_refund',
        args: { amount: 50000, chargeId: 'ch_998' },
      };

      const secondAttempt = await manager.acquireForTool(duplicateCall);
      expect(secondAttempt.success).toBe(false);
      expect(secondAttempt.reason).toBe(EIdempotencyStatus.IN_PROGRESS);

      // Complete first call
      await manager.complete(firstAttempt.fingerprint, { status: 'refunded', txId: 'tx_123' });

      // Third call after completion returns previous cached result
      const thirdAttempt = await manager.acquireForTool(initialCall);
      expect(thirdAttempt.success).toBe(false);
      expect(thirdAttempt.reason).toBe(EIdempotencyStatus.EXECUTED);
      expect(thirdAttempt.previousResult).toEqual({ status: 'refunded', txId: 'tx_123' });
    });

    it('releases lock upon failure allowing subsequent retry', async () => {
      const toolParams = {
        userId: 'user-ops',
        provider: 'sql_server',
        toolName: 'execute_write_query',
        args: { query: 'DROP TABLE temp_logs' },
      };

      const firstAttempt = await manager.acquireForTool(toolParams);
      expect(firstAttempt.success).toBe(true);

      // Simulating failure -> release lock
      await manager.release(firstAttempt.fingerprint);

      // Next attempt should succeed
      const retryAttempt = await manager.acquireForTool(toolParams);
      expect(retryAttempt.success).toBe(true);
    });
  });

  describe('legacy generateKey compatibility', () => {
    it('generates key formatted as action:entity:user', () => {
      const key = manager.generateKey(EActionType.REFUND_ORDER, '102', 'u-1');
      expect(key).toBe('refund_order:102:u-1');
    });
  });
});
