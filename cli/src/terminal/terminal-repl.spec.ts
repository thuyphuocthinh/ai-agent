import { Readable, Writable } from 'stream';
import { TerminalRepl } from './terminal-repl';
import { CoreChatClient } from './core-chat.client';
import { UiChunk } from './terminal-chat.types';

describe('TerminalRepl', () => {
  let outData: string;
  let mockOut: Writable;
  let mockIn: Readable;

  beforeEach(() => {
    outData = '';
    mockOut = new Writable({
      write(chunk, _encoding, callback) {
        outData += chunk.toString();
        callback();
      },
    });
    mockIn = new Readable({
      read() {},
    });
  });

  const pushLines = (...lines: string[]) => {
    for (const line of lines) {
      mockIn.push(line + '\n');
    }
    // push null to signal EOF if needed
  };

  it('should print header, session ID and handle exit command', async () => {
    const repl = new TerminalRepl({
      inputStream: mockIn,
      outputStream: mockOut,
    });

    const runPromise = repl.start();
    pushLines('exit');
    await runPromise;

    expect(outData).toContain('Agents CLI');
    expect(outData).toContain('Session ID:');
    expect(outData).toContain('Goodbye! 👋');
  });

  it('should handle /help command and display available commands', async () => {
    const repl = new TerminalRepl({
      inputStream: mockIn,
      outputStream: mockOut,
    });

    const runPromise = repl.start();
    pushLines('/help', 'quit');
    await runPromise;

    expect(outData).toContain('Danh sách lệnh hỗ trợ:');
    expect(outData).toContain('/new');
    expect(outData).toContain('/help');
    expect(outData).toContain('/exit');
  });

  it('should reset session ID when /new command is issued', async () => {
    const repl = new TerminalRepl({
      inputStream: mockIn,
      outputStream: mockOut,
    });

    const firstSession = repl.getSessionId();
    const runPromise = repl.start();
    pushLines('/new', 'exit');
    await runPromise;

    const secondSession = repl.getSessionId();
    expect(secondSession).not.toBe(firstSession);
    expect(outData).toContain('Đã bắt đầu phiên làm việc mới');
  });

  it('should send user chat message and stream responses', async () => {
    async function* generateChunks(): AsyncGenerator<UiChunk> {
      yield { type: 'data-persona', data: { name: 'SupportAgent', role: 'SupportAgent' } };
      yield { type: 'text-delta', text: 'Chào bạn, tôi có thể giúp gì?' };
      yield { type: 'finish' };
    }

    const mockClient = {
      getCoreUrl: () => 'http://localhost:3000',
      chat: jest.fn().mockResolvedValue({
        sessionId: 'returned-session-id',
        chunks: generateChunks(),
      }),
      approve: jest.fn(),
    } as unknown as CoreChatClient;

    const repl = new TerminalRepl({
      client: mockClient,
      inputStream: mockIn,
      outputStream: mockOut,
    });

    const runPromise = repl.start();
    pushLines('Tôi muốn hỏi về sản phẩm', 'exit');
    await runPromise;

    expect(mockClient.chat).toHaveBeenCalledWith('Tôi muốn hỏi về sản phẩm', expect.any(String));
    expect(outData).toContain('SupportAgent');
    expect(outData).toContain('Chào bạn, tôi có thể giúp gì?');
    expect(repl.getSessionId()).toBe('returned-session-id');
  });

  it('should prompt user for HITL approval and call approve with "approve"', async () => {
    async function* generateInitialChunks(): AsyncGenerator<UiChunk> {
      yield {
        type: 'data-approval',
        data: { id: 'appr-99', action: 'db_delete', summary: 'Xóa bảng dữ liệu' },
      };
      yield { type: 'finish' };
    }

    async function* generateApprovedChunks(): AsyncGenerator<UiChunk> {
      yield { type: 'text-delta', text: 'Đã hoàn tất xóa dữ liệu.' };
      yield { type: 'finish' };
    }

    const mockClient = {
      getCoreUrl: () => 'http://localhost:3000',
      chat: jest.fn().mockResolvedValue({
        sessionId: 'test-sess',
        chunks: generateInitialChunks(),
      }),
      approve: jest.fn().mockResolvedValue(generateApprovedChunks()),
    } as unknown as CoreChatClient;

    const repl = new TerminalRepl({
      client: mockClient,
      inputStream: mockIn,
      outputStream: mockOut,
    });

    const runPromise = repl.start();
    // 1: prompt chat, 2: answer approval prompt with 'y', 3: exit
    pushLines('Xóa bảng dữ liệu giúp tôi', 'y', 'exit');
    await runPromise;

    expect(mockClient.approve).toHaveBeenCalledWith('test-sess', 'appr-99', 'approve');
    expect(outData).toContain('CẦN PHÊ DUYỆT HÀNH ĐỘNG RỦI RO');
    expect(outData).toContain('Xóa bảng dữ liệu');
    expect(outData).toContain('Đã chấp thuận hành động');
    expect(outData).toContain('Đã hoàn tất xóa dữ liệu.');
  });

  it('should display friendly error when Core server is unreachable', async () => {
    const mockClient = {
      getCoreUrl: () => 'http://127.0.0.1:3000',
      chat: jest.fn().mockRejectedValue(new Error('connect ECONNREFUSED 127.0.0.1:3000')),
      approve: jest.fn(),
    } as unknown as CoreChatClient;

    const repl = new TerminalRepl({
      client: mockClient,
      inputStream: mockIn,
      outputStream: mockOut,
    });

    const runPromise = repl.start();
    pushLines('Xin chào', 'exit');
    await runPromise;

    expect(outData).toContain('Không thể kết nối tới Core Server tại http://127.0.0.1:3000');
    expect(outData).toContain('pnpm --filter @agent/core start:dev');
  });
});
