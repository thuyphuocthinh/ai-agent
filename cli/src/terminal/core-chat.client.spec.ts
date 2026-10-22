import { createServer, Server } from 'http';
import { AddressInfo } from 'net';
import { CoreChatClient } from './core-chat.client';
import { UiChunk } from './terminal-chat.types';

describe('CoreChatClient', () => {
  let server: Server;
  let coreUrl: string;
  let client: CoreChatClient;
  let receivedRequests: Array<{
    method?: string;
    url?: string;
    headers: Record<string, string | string[] | undefined>;
    body: string;
  }> = [];

  const listen = (s: Server) =>
    new Promise<number>((resolve) =>
      s.listen(0, '127.0.0.1', () => resolve((s.address() as AddressInfo).port)),
    );

  const close = (s: Server) =>
    new Promise<void>((resolve) => {
      s.closeAllConnections?.();
      s.close(() => resolve());
    });

  beforeEach(async () => {
    receivedRequests = [];
    server = createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
      });
      req.on('end', () => {
        receivedRequests.push({
          method: req.method,
          url: req.url,
          headers: req.headers,
          body,
        });

        if (req.url === '/api/chat' && req.method === 'POST') {
          res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'x-playground-session': 'test-session-123',
          });
          res.write(': comment ping\n\n');
          res.write('data: {"type":"text-delta","text":"Xin chào!"}\n\n');
          res.write('data: {"type":"data-approval","data":{"id":"appr-1","action":"db_write","summary":"Xóa bản ghi"}}\n\n');
          res.write('data: {"type":"finish"}\n\n');
          res.end();
        } else if (req.url === '/api/approve' && req.method === 'POST') {
          res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'x-playground-session': 'test-session-123',
          });
          res.write('data: {"type":"text-delta","text":"Đã duyệt thành công."}\n\n');
          res.write('data: {"type":"finish"}\n\n');
          res.end();
        } else if (req.url === '/api/error' && req.method === 'POST') {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Internal Server Error' }));
        } else {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ message: 'Not found' }));
        }
      });
    });

    const port = await listen(server);
    coreUrl = `http://127.0.0.1:${port}`;
    client = new CoreChatClient({ coreUrl });
  });

  afterEach(async () => {
    await close(server);
  });

  it('should send POST /api/chat with prompt and sessionId and stream UI chunks', async () => {
    const { sessionId, chunks } = await client.chat('Xin chào bot', 'client-sess-1');
    expect(sessionId).toBe('test-session-123');

    const receivedChunks: UiChunk[] = [];
    for await (const chunk of chunks) {
      receivedChunks.push(chunk);
    }

    expect(receivedRequests.length).toBe(1);
    expect(receivedRequests[0].method).toBe('POST');
    expect(receivedRequests[0].url).toBe('/api/chat');
    expect(JSON.parse(receivedRequests[0].body)).toEqual({
      prompt: 'Xin chào bot',
      sessionId: 'client-sess-1',
    });

    expect(receivedChunks).toHaveLength(3);
    expect(receivedChunks[0]).toEqual({ type: 'text-delta', text: 'Xin chào!' });
    expect(receivedChunks[1]).toEqual({
      type: 'data-approval',
      data: { id: 'appr-1', action: 'db_write', summary: 'Xóa bản ghi' },
    });
    expect(receivedChunks[2]).toEqual({ type: 'finish' });
  });

  it('should send POST /api/approve with action and stream UI chunks', async () => {
    const chunks = await client.approve('test-session-123', 'appr-1', 'approve');

    const receivedChunks: UiChunk[] = [];
    for await (const chunk of chunks) {
      receivedChunks.push(chunk);
    }

    expect(receivedRequests.length).toBe(1);
    expect(receivedRequests[0].method).toBe('POST');
    expect(receivedRequests[0].url).toBe('/api/approve');
    expect(JSON.parse(receivedRequests[0].body)).toEqual({
      sessionId: 'test-session-123',
      messageId: 'appr-1',
      action: 'approve',
    });

    expect(receivedChunks).toHaveLength(2);
    expect(receivedChunks[0]).toEqual({ type: 'text-delta', text: 'Đã duyệt thành công.' });
    expect(receivedChunks[1]).toEqual({ type: 'finish' });
  });

  it('should throw Error when Core server returns non-ok status', async () => {
    const errorClient = new CoreChatClient({ coreUrl: `${coreUrl}/api/error` });
    // Point directly to error endpoint by overriding URL or mocking
    await expect(errorClient.chat('fail')).rejects.toThrow(/Core Server error/);
  });
});
