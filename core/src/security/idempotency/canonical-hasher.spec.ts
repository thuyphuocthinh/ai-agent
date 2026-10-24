import {
  canonicalSortedJson,
  computeCanonicalToolFingerprint,
} from './canonical-hasher';

describe('CanonicalHasher', () => {
  describe('canonicalSortedJson', () => {
    it('should format primitives deterministically', () => {
      expect(canonicalSortedJson(null)).toBe('null');
      expect(canonicalSortedJson(undefined)).toBe('null');
      expect(canonicalSortedJson(123)).toBe('123');
      expect(canonicalSortedJson('test')).toBe('"test"');
      expect(canonicalSortedJson(true)).toBe('true');
      expect(canonicalSortedJson(false)).toBe('false');
    });

    it('should sort object keys alphabetically regardless of declaration order', () => {
      const obj1 = { z: 1, a: 2, m: 3 };
      const obj2 = { a: 2, m: 3, z: 1 };
      const obj3 = { m: 3, z: 1, a: 2 };

      const serialized1 = canonicalSortedJson(obj1);
      const serialized2 = canonicalSortedJson(obj2);
      const serialized3 = canonicalSortedJson(obj3);

      expect(serialized1).toBe('{"a":2,"m":3,"z":1}');
      expect(serialized1).toBe(serialized2);
      expect(serialized2).toBe(serialized3);
    });

    it('should recursively sort nested object keys', () => {
      const complex1 = {
        outer: {
          beta: 'b',
          alpha: 'a',
        },
        payload: {
          detail: {
            y: 2,
            x: 1,
          },
          count: 10,
        },
      };

      const complex2 = {
        payload: {
          count: 10,
          detail: {
            x: 1,
            y: 2,
          },
        },
        outer: {
          alpha: 'a',
          beta: 'b',
        },
      };

      expect(canonicalSortedJson(complex1)).toBe(canonicalSortedJson(complex2));
      expect(canonicalSortedJson(complex1)).toBe(
        '{"outer":{"alpha":"a","beta":"b"},"payload":{"count":10,"detail":{"x":1,"y":2}}}',
      );
    });

    it('should preserve array element order while recursively sorting object keys inside arrays', () => {
      const arr1 = [
        { b: 2, a: 1 },
        { d: 4, c: 3 },
      ];
      const arr2 = [
        { a: 1, b: 2 },
        { c: 3, d: 4 },
      ];

      expect(canonicalSortedJson(arr1)).toBe(canonicalSortedJson(arr2));
      expect(canonicalSortedJson(arr1)).toBe(
        '[{"a":1,"b":2},{"c":3,"d":4}]',
      );
    });

    it('should omit undefined properties and function fields', () => {
      const obj = {
        valid: 42,
        ignoreMe: undefined,
        fn: () => 'noop',
      };

      expect(canonicalSortedJson(obj)).toBe('{"valid":42}');
    });

    it('should serialize Date objects to ISO string', () => {
      const date = new Date('2026-10-24T12:00:00.000Z');
      expect(canonicalSortedJson({ timestamp: date })).toBe(
        '{"timestamp":"2026-10-24T12:00:00.000Z"}',
      );
    });
  });

  describe('computeCanonicalToolFingerprint', () => {
    it('should generate identical 64-char hex SHA-256 fingerprints for equivalent tool calls with scrambled arg keys', () => {
      const call1 = {
        userId: 'user-01',
        provider: 'SQL_SERVER',
        toolName: 'execute_write_query',
        args: {
          query: 'UPDATE orders SET status = "paid" WHERE id = 102',
          timeout: 5000,
          retries: 3,
        },
      };

      const call2 = {
        userId: 'user-01',
        provider: 'sql_server',
        toolName: 'EXECUTE_WRITE_QUERY',
        args: {
          retries: 3,
          query: 'UPDATE orders SET status = "paid" WHERE id = 102',
          timeout: 5000,
        },
      };

      const hash1 = computeCanonicalToolFingerprint(call1);
      const hash2 = computeCanonicalToolFingerprint(call2);

      expect(hash1).toHaveLength(64);
      expect(hash1).toMatch(/^[0-9a-f]{64}$/);
      expect(hash1).toBe(hash2);
    });

    it('should generate different fingerprints when arguments or targets differ', () => {
      const base = {
        userId: 'user-01',
        provider: 'sql_server',
        toolName: 'execute_write_query',
        args: { id: 101 },
      };

      const diffUser = computeCanonicalToolFingerprint({ ...base, userId: 'user-02' });
      const diffProvider = computeCanonicalToolFingerprint({ ...base, provider: 'postgres' });
      const diffTool = computeCanonicalToolFingerprint({ ...base, toolName: 'read_query' });
      const diffArgs = computeCanonicalToolFingerprint({
        ...base,
        args: { id: 102 },
      });

      const baseHash = computeCanonicalToolFingerprint(base);

      expect(baseHash).not.toBe(diffUser);
      expect(baseHash).not.toBe(diffProvider);
      expect(baseHash).not.toBe(diffTool);
      expect(baseHash).not.toBe(diffArgs);
    });

    it('should handle undefined or empty args cleanly', () => {
      const hashEmpty = computeCanonicalToolFingerprint({
        userId: 'user-01',
        provider: 'slack',
        toolName: 'list_channels',
        args: {},
      });

      const hashUndefined = computeCanonicalToolFingerprint({
        userId: 'user-01',
        provider: 'slack',
        toolName: 'list_channels',
      });

      expect(hashEmpty).toBe(hashUndefined);
    });
  });
});
