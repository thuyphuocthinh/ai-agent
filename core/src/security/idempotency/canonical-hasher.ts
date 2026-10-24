import { createHash } from 'node:crypto';
import type { CanonicalToolFingerprintParams } from './idempotency.types';

/**
 * Serializes any JavaScript value into a deterministic, canonical JSON string
 * where all object keys are recursively sorted in lexicographical order.
 */
export function canonicalSortedJson(value: unknown): string {
  if (value === null || value === undefined) {
    return 'null';
  }

  if (typeof value === 'boolean' || typeof value === 'number') {
    return JSON.stringify(value);
  }

  if (typeof value === 'string') {
    return JSON.stringify(value);
  }

  if (value instanceof Date) {
    return JSON.stringify(value.toISOString());
  }

  if (Array.isArray(value)) {
    const items = value.map((item) => canonicalSortedJson(item));
    return `[${items.join(',')}]`;
  }

  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const sortedKeys = Object.keys(obj).sort();
    const entries: string[] = [];

    for (const key of sortedKeys) {
      const val = obj[key];
      // Omit undefined values and functions matching standard JSON.stringify behavior
      if (val !== undefined && typeof val !== 'function') {
        entries.push(`${JSON.stringify(key)}:${canonicalSortedJson(val)}`);
      }
    }

    return `{${entries.join(',')}}`;
  }

  return JSON.stringify(value);
}

/**
 * Computes a unique 64-character SHA-256 fingerprint for a tool execution request.
 * Signature formula:
 *   Key = SHA-256(userId : provider.toLowerCase() : toolName.toLowerCase() : canonicalSortedJson(args))
 */
export function computeCanonicalToolFingerprint(
  params: CanonicalToolFingerprintParams,
): string {
  const { userId, provider, toolName, args = {} } = params;
  const canonicalArgs = canonicalSortedJson(args);
  const payload = `${userId}:${provider.toLowerCase()}:${toolName.toLowerCase()}:${canonicalArgs}`;

  return createHash('sha256').update(payload).digest('hex');
}
