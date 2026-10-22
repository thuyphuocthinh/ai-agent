import { ChildProcess } from 'child_process';
import { CoreProcessManager } from './core-process-manager';
import { Writable } from 'stream';

describe('CoreProcessManager', () => {
  let mockOut: Writable;
  let outData: string;

  beforeEach(() => {
    outData = '';
    mockOut = new Writable({
      write(chunk, _encoding, callback) {
        outData += chunk.toString();
        callback();
      },
    });
  });

  describe('isAlive', () => {
    it('returns true when core returns 200', async () => {
      const mockFetch = jest.fn().mockResolvedValue({ status: 200 });
      const manager = new CoreProcessManager({ fetchFn: mockFetch });

      const alive = await manager.isAlive('http://127.0.0.1:3000');
      expect(alive).toBe(true);
    });

    it('returns false when fetch rejects with connection error', async () => {
      const mockFetch = jest.fn().mockRejectedValue(new Error('ECONNREFUSED'));
      const manager = new CoreProcessManager({ fetchFn: mockFetch });

      const alive = await manager.isAlive('http://127.0.0.1:3000');
      expect(alive).toBe(false);
    });
  });

  describe('ensureRunning', () => {
    it('does not spawn if already alive', async () => {
      const mockFetch = jest.fn().mockResolvedValue({ status: 200 });
      const mockSpawn = jest.fn();
      const manager = new CoreProcessManager({
        fetchFn: mockFetch,
        spawnFn: mockSpawn as unknown as typeof import('child_process').spawn,
      });

      const cleanup = await manager.ensureRunning('http://127.0.0.1:3000', '/test/root', {
        outStream: mockOut,
      });

      expect(mockSpawn).not.toHaveBeenCalled();
      expect(outData).toBe('');
      cleanup();
    });

    it('spawns core process and waits until alive', async () => {
      let callCount = 0;
      const mockFetch = jest.fn().mockImplementation(async () => {
        callCount++;
        if (callCount < 3) throw new Error('ECONNREFUSED');
        return { status: 200 };
      });

      const mockKill = jest.fn();
      const mockChild = { pid: 9999, kill: mockKill } as unknown as ChildProcess;
      const mockSpawn = jest.fn().mockReturnValue(mockChild);
      const mockExecSync = jest.fn();

      const manager = new CoreProcessManager({
        fetchFn: mockFetch,
        spawnFn: mockSpawn as unknown as typeof import('child_process').spawn,
        execSyncFn: mockExecSync as unknown as typeof import('child_process').execSync,
      });

      const cleanup = await manager.ensureRunning('http://127.0.0.1:3000', '/test/root', {
        maxRetries: 5,
        retryIntervalMs: 5,
        outStream: mockOut,
      });

      expect(mockSpawn).toHaveBeenCalled();
      expect(outData).toContain('Core Engine chưa chạy');
      expect(outData).toContain('Core Engine đã sẵn sàng');

      // Test cleanup
      cleanup();
      if (process.platform === 'win32') {
        expect(mockExecSync).toHaveBeenCalledWith(expect.stringContaining('taskkill /pid 9999'), expect.any(Object));
      } else {
        expect(mockKill).toHaveBeenCalledWith('SIGTERM');
      }
    });

    it('throws timeout error if server never becomes alive', async () => {
      const mockFetch = jest.fn().mockRejectedValue(new Error('ECONNREFUSED'));
      const mockKill = jest.fn();
      const mockChild = { pid: 9999, kill: mockKill } as unknown as ChildProcess;
      const mockSpawn = jest.fn().mockReturnValue(mockChild);
      const mockExecSync = jest.fn();

      const manager = new CoreProcessManager({
        fetchFn: mockFetch,
        spawnFn: mockSpawn as unknown as typeof import('child_process').spawn,
        execSyncFn: mockExecSync as unknown as typeof import('child_process').execSync,
      });

      await expect(
        manager.ensureRunning('http://127.0.0.1:3000', '/test/root', {
          maxRetries: 3,
          retryIntervalMs: 5,
          outStream: mockOut,
        }),
      ).rejects.toThrow(/Quá thời gian chờ khởi động Core Server/);
    });
  });
});
