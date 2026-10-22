import { randomUUID } from 'crypto';
import * as readline from 'readline';
import { CoreChatClient } from './core-chat.client';
import { TerminalStreamRenderer } from './terminal-stream-renderer';
import { ANSI, TerminalFormatter } from './terminal-formatter';
import { ApprovalData } from './terminal-chat.types';

export interface TerminalReplOptions {
  client?: CoreChatClient;
  renderer?: TerminalStreamRenderer;
  inputStream?: NodeJS.ReadableStream;
  outputStream?: NodeJS.WritableStream;
}

export class TerminalRepl {
  private readonly client: CoreChatClient;
  private readonly renderer: TerminalStreamRenderer;
  private readonly inputStream: NodeJS.ReadableStream;
  private readonly outputStream: NodeJS.WritableStream;
  private sessionId: string;
  private isRunning = false;

  constructor(options?: TerminalReplOptions) {
    this.client = options?.client ?? new CoreChatClient();
    this.renderer = options?.renderer ?? new TerminalStreamRenderer({ outStream: options?.outputStream });
    this.inputStream = options?.inputStream ?? process.stdin;
    this.outputStream = options?.outputStream ?? process.stdout;
    this.sessionId = randomUUID();
  }

  getSessionId(): string {
    return this.sessionId;
  }

  resetSession(): void {
    this.sessionId = randomUUID();
  }

  async start(): Promise<void> {
    this.isRunning = true;
    this.outputStream.write(TerminalFormatter.header());
    this.outputStream.write(`  Session ID: ${ANSI.dim}${this.sessionId}${ANSI.reset}\n\n`);

    const rl = readline.createInterface({
      input: this.inputStream,
      output: this.outputStream,
      terminal: false,
    });

    const lineQueue: string[] = [];
    let pendingResolver: ((line: string) => void) | null = null;

    rl.on('line', (line: string) => {
      if (pendingResolver) {
        const resolve = pendingResolver;
        pendingResolver = null;
        resolve(line);
      } else {
        lineQueue.push(line);
      }
    });

    rl.on('close', () => {
      this.isRunning = false;
      if (pendingResolver) {
        const resolve = pendingResolver;
        pendingResolver = null;
        resolve('exit');
      }
    });

    const promptUser = (query: string): Promise<string> => {
      this.outputStream.write(query);
      if (lineQueue.length > 0) {
        return Promise.resolve(lineQueue.shift()!.trim());
      }
      return new Promise((resolve) => {
        pendingResolver = (line) => resolve(line.trim());
      });
    };

    try {
      while (this.isRunning) {
        const input = await promptUser(`${ANSI.bold}You > ${ANSI.reset}`);
        if (!input) continue;

        const cmd = input.toLowerCase();
        if (cmd === 'exit' || cmd === 'quit' || cmd === '/exit' || cmd === '/quit') {
          this.outputStream.write(`\nGoodbye! 👋\n`);
          this.isRunning = false;
          break;
        }

        if (cmd === '/new') {
          this.resetSession();
          this.outputStream.write(`\n${TerminalFormatter.info(`Đã bắt đầu phiên làm việc mới (Session ID: ${this.sessionId})`)}\n\n`);
          continue;
        }

        if (cmd === '/help') {
          this.printHelp();
          continue;
        }

        await this.handleUserTurn(input, promptUser);
      }
    } finally {
      rl.close();
    }
  }

  private async handleUserTurn(
    prompt: string,
    promptUser: (query: string) => Promise<string>,
  ): Promise<void> {
    this.renderer.reset();

    try {
      const { sessionId, chunks } = await this.client.chat(prompt, this.sessionId);
      if (sessionId) {
        this.sessionId = sessionId;
      }

      await this.renderer.renderStream(
        chunks,
        async (_approval: ApprovalData) => {
          const ans = await promptUser(
            `${ANSI.bold}Bạn có muốn duyệt hành động này không? [y/N]: ${ANSI.reset}`,
          );
          const isApproved = ans.toLowerCase() === 'y' || ans.toLowerCase() === 'yes';
          return isApproved ? 'approve' : 'reject';
        },
        async (action: 'approve' | 'reject', messageId: string) => {
          this.outputStream.write(
            action === 'approve'
              ? `\n${ANSI.green}✔ Đã chấp thuận hành động. Đang tiếp tục xử lý...${ANSI.reset}\n`
              : `\n${ANSI.red}✖ Đã từ chối hành động. Đang hủy bước này...${ANSI.reset}\n`,
          );
          return this.client.approve(this.sessionId, messageId, action);
        },
      );
      this.outputStream.write('\n\n');
    } catch (err: unknown) {
      const message = (err as Error)?.message || String(err);
      if (message.includes('ECONNREFUSED') || message.includes('fetch failed')) {
        this.outputStream.write(
          TerminalFormatter.error(
            `Không thể kết nối tới Core Server tại ${this.client.getCoreUrl()}.\n` +
            `👉 Vui lòng khởi động Core Server trước bằng lệnh:\n` +
            `   pnpm --filter @agent/core start:dev`,
          ) + '\n',
        );
      } else {
        this.outputStream.write(TerminalFormatter.error(`Lỗi: ${message}`) + '\n');
      }
    }
  }

  private printHelp(): void {
    const helpText = [
      '',
      `${ANSI.bold}Danh sách lệnh hỗ trợ:${ANSI.reset}`,
      `  ${ANSI.cyan}/new${ANSI.reset}         Bắt đầu phiên trò chuyện mới (reset ngữ cảnh)`,
      `  ${ANSI.cyan}/help${ANSI.reset}        Xem hướng dẫn sử dụng`,
      `  ${ANSI.cyan}/exit, quit${ANSI.reset}  Thoát khỏi Agents CLI`,
      '',
    ].join('\n');
    this.outputStream.write(helpText);
  }
}
