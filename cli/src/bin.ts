#!/usr/bin/env node
import { CliService } from './cli.service';
import { CliWebServer, DEFAULT_CORE_URL } from './web/cli-web.server';

async function runCli() {
  const cli = new CliService();

  console.log('====================================================');
  console.log('🤖 Agents CLI — Interactive AI Orchestration Console');
  console.log('====================================================');
  console.log('Type your instructions below. Type "exit" or "quit" to quit.\n');

  while (true) {
    const input = await cli.promptUser('You > ');
    if (!input) continue;

    if (input.toLowerCase() === 'exit' || input.toLowerCase() === 'quit') {
      console.log('Goodbye! 👋');
      process.exit(0);
    }

    await cli.emitStep(
      { conversationId: 'cli', userId: 'local-user', messageId: 'turn', sessionType: 'cli' },
      { type: 'step_start', label: 'Processing query...' },
    );

    // Simulated response for standalone CLI testing
    await cli.emitToken(
      { conversationId: 'cli', userId: 'local-user', messageId: 'turn', sessionType: 'cli' },
      `Received instruction: "${input}"\n`,
    );
    await cli.flush();

    await cli.emitStep(
      { conversationId: 'cli', userId: 'local-user', messageId: 'turn', sessionType: 'cli' },
      { type: 'done' },
    );
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
