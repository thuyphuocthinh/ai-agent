import { spawn, ChildProcess, execSync } from 'child_process';

export interface CoreProcessManagerOptions {
  spawnFn?: typeof spawn;
  execSyncFn?: typeof execSync;
  fetchFn?: typeof fetch;
}

export class CoreProcessManager {
  private childProcess: ChildProcess | null = null;
  private readonly spawnFn: typeof spawn;
  private readonly execSyncFn: typeof execSync;
  private readonly fetchFn: typeof fetch;

  constructor(options?: CoreProcessManagerOptions) {
    this.spawnFn = options?.spawnFn ?? spawn;
    this.execSyncFn = options?.execSyncFn ?? execSync;
    this.fetchFn = options?.fetchFn ?? fetch;
  }

  async isAlive(coreUrl: string): Promise<boolean> {
    try {
      const url = new URL(coreUrl);
      const res = await this.fetchFn(`${url.origin}/api/history`, {
        signal: AbortSignal.timeout(1000),
      });
      return res.status === 200 || res.status === 404;
    } catch {
      return false;
    }
  }

  async ensureRunning(
    coreUrl: string,
    rootDir: string,
    options?: { maxRetries?: number; retryIntervalMs?: number; outStream?: NodeJS.WritableStream },
  ): Promise<() => void> {
    const out = options?.outStream ?? process.stdout;
    const alive = await this.isAlive(coreUrl);
    if (alive) {
      return () => {};
    }

    out.write(`\n⏳ Core Engine chưa chạy. Đang tự động khởi động @agent/core trong nền...\n`);

    const pnpmCmd = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
    this.childProcess = this.spawnFn(pnpmCmd, ['--filter', '@agent/core', 'start:dev'], {
      cwd: rootDir,
      shell: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const cleanup = () => {
      if (this.childProcess && this.childProcess.pid) {
        try {
          if (process.platform === 'win32') {
            this.execSyncFn(`taskkill /pid ${this.childProcess.pid} /T /F`, { stdio: 'ignore' });
          } else {
            this.childProcess.kill('SIGTERM');
          }
        } catch {
          // ignore cleanup errors
        }
        this.childProcess = null;
      }
    };

    const maxRetries = options?.maxRetries ?? 60;
    const interval = options?.retryIntervalMs ?? 500;

    for (let i = 0; i < maxRetries; i++) {
      await new Promise((r) => setTimeout(r, interval));
      if (await this.isAlive(coreUrl)) {
        out.write(`✔ Core Engine đã sẵn sàng tại ${coreUrl}!\n\n`);
        return cleanup;
      }
    }

    cleanup();
    throw new Error(
      `Quá thời gian chờ khởi động Core Server tại ${coreUrl}.\n` +
      `Vui lòng thử chạy thủ công: pnpm --filter @agent/core start:dev`,
    );
  }
}
