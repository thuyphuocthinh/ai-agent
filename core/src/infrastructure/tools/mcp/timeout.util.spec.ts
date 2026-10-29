import { withTimeout } from './timeout.util';

describe('withTimeout', () => {
  it('resolves value when promise finishes within timeout limit', async () => {
    const promise = Promise.resolve('hello world');
    const result = await withTimeout(promise, 100, 'timeout');
    expect(result).toBe('hello world');
  });

  it('rejects with timeout message when promise exceeds timeout limit', async () => {
    const neverResolves = new Promise((resolve) => setTimeout(resolve, 200));
    await expect(withTimeout(neverResolves, 20, 'Operation timed out')).rejects.toThrow(
      'Operation timed out',
    );
  });

  it('aborts controller when timeout fires', async () => {
    const controller = new AbortController();
    const slow = new Promise((resolve) => setTimeout(resolve, 200));
    await expect(withTimeout(slow, 20, 'Operation timed out', controller)).rejects.toThrow(
      'Operation timed out',
    );
    expect(controller.signal.aborted).toBe(true);
  });

  it('propagates original error if promise rejects before timeout', async () => {
    const failingPromise = Promise.reject(new Error('Internal failure'));
    await expect(withTimeout(failingPromise, 100, 'timeout')).rejects.toThrow('Internal failure');
  });
});
