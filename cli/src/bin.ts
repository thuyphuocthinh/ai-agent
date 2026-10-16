#!/usr/bin/env node
import { CliService } from './cli.service';

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
      { channelId: 'cli', userId: 'local-user', messageId: 'turn', channelType: 'cli' },
      { type: 'step_start', label: 'Processing query...' },
    );

    // Simulated response for standalone CLI testing
    await cli.emitToken(
      { channelId: 'cli', userId: 'local-user', messageId: 'turn', channelType: 'cli' },
      `Received instruction: "${input}"\n`,
    );
    await cli.flush();

    await cli.emitStep(
      { channelId: 'cli', userId: 'local-user', messageId: 'turn', channelType: 'cli' },
      { type: 'done' },
    );
  }
}

if (require.main === module) {
  runCli().catch((err) => {
    console.error('Fatal CLI Error:', err);
    process.exit(1);
  });
}

export { runCli };
