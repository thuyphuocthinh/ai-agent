#!/usr/bin/env node
import * as path from 'path';
import { CliWebServer, DEFAULT_CORE_URL } from './web/cli-web.server';
import { TerminalRepl } from './terminal/terminal-repl';
import { CoreProcessManager } from './terminal/core-process-manager';

async function runCli() {
  const coreUrl = process.env.CORE_URL ?? DEFAULT_CORE_URL;
  const manager = new CoreProcessManager();
  let cleanupCore: (() => void) | undefined;

  const onExit = () => {
    if (cleanupCore) {
      cleanupCore();
      cleanupCore = undefined;
    }
  };

  process.once('SIGINT', () => {
    onExit();
    process.exit(0);
  });
  process.once('SIGTERM', () => {
    onExit();
    process.exit(0);
  });

  try {
    const rootDir = path.resolve(__dirname, '../..');
    cleanupCore = await manager.ensureRunning(coreUrl, rootDir);

    const repl = new TerminalRepl();
    await repl.start();
  } finally {
    onExit();
  }
}

/** `--web [port]`: server web playground (chuyển tiếp /api/* sang core). */
async function runWeb(port?: number) {
  const server = new CliWebServer({ port });
  const bound = await server.start();
  console.log(`🌐 Playground: http://localhost:${bound}`);
  console.log(`   Core: ${process.env.CORE_URL ?? DEFAULT_CORE_URL} (cần đang chạy: pnpm --filter @agent/core start:dev)`);
}

function parsePort(value?: string): number | undefined {
  const port = Number(value);
  return Number.isInteger(port) && port > 0 ? port : undefined;
}

if (require.main === module) {
  const webIndex = process.argv.indexOf('--web');
  const task =
    webIndex === -1 ? runCli() : runWeb(parsePort(process.argv[webIndex + 1]));
  task.catch((err) => {
    console.error('Fatal CLI Error:', err);
    process.exit(1);
  });
}

export { runCli, runWeb };
