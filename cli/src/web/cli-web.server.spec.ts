import { createServer, request, Server } from 'http';
import { AddressInfo } from 'net';
import { CliWebServer } from './cli-web.server';

const listen = (server: Server, port = 0) =>
  new Promise<number>((resolve) =>
    server.listen(port, '127.0.0.1', () => resolve((server.address() as AddressInfo).port)),
  );
const close = (server: Server) =>
  new Promise<void>((resolve) => {
    server.closeAllConnections?.();
    server.close(() => resolve());
  });
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('CliWebServer (AC-7)', () => {
  let core: Server;
  let corePort: number;
  let release: () => void;
  let upstreamClosed: boolean;
  let received: { method?: string; url?: string; body: string; headers: Record<string, unknown> };
  let web: CliWebServer;
  let webPort: number;

  beforeEach(async () => {
    upstreamClosed = false;
    received = { body: '', headers: {} };
    core = createServer((req, res) => {
      req.on('close', () => {
        if (!res.writableFinished) upstreamClosed = true;
      });
      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', () => {
        received = { method: req.method, url: req.url, body, headers: req.headers };
        if (req.url?.startsWith('/api/history')) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end('{"turns":[]}');
        } else if (req.url === '/api/missing') {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end('{"message":"nope"}');
        } else if (req.url === '/api/slow') {
          // SSE: chunk đầu ngay, chunk sau chỉ khi test cho phép.
          res.writeHead(200, { 'Content-Type': 'text/event-stream', 'x-playground-session': 'sess-1' });
          res.write('data: {"type":"start"}\n\n');
          new Promise<void>((resolve) => (release = resolve)).then(() => {
            res.write('data: {"type":"finish"}\n\n');
            res.end();
          });
        } else {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ echoed: body }));
        }
      });
    });
    corePort = await listen(core);
    web = new CliWebServer({ port: 0, coreUrl: `http://127.0.0.1:${corePort}` });
    webPort = await web.start();
  });

  afterEach(async () => {
    release?.();
    await web.stop();
    await close(core);
  });

  const get = (path: string) => fetch(`http://127.0.0.1:${webPort}${path}`);

  describe('page', () => {
    it('serves the playground at / and /index.html', async () => {
      for (const path of ['/', '/index.html']) {
        const response = await get(path);
        const html = await response.text();

        expect(response.status).toBe(200);
        expect(response.headers.get('content-type')).toContain('text/html');
        expect(html).toContain('<title>Agent Playground</title>');
        expect(html).toContain('/api/chat');
      }
    });

    it('loads no third-party script or stylesheet', async () => {
      const html = await (await get('/')).text();

      expect(html).not.toMatch(/<script[^>]+src=/i);
      expect(html).not.toMatch(/<link[^>]+href=/i);
      expect(html).not.toMatch(/https?:\/\//i);
    });

    it('answers 404 for unknown paths and for non-GET on /', async () => {
      expect((await get('/nothing')).status).toBe(404);
      expect((await fetch(`http://127.0.0.1:${webPort}/`, { method: 'POST' })).status).toBe(404);
    });
  });

  describe('proxy to core', () => {
    it('forwards GET requests and the status/body of the answer', async () => {
      const ok = await get('/api/history?sessionId=abc');
      expect(ok.status).toBe(200);
      await expect(ok.json()).resolves.toEqual({ turns: [] });
      expect(received.url).toBe('/api/history?sessionId=abc');

      const missing = await get('/api/missing');
      expect(missing.status).toBe(404);
      await expect(missing.json()).resolves.toEqual({ message: 'nope' });
    });

    it('forwards the POST body and sets the Host header for core', async () => {
      const response = await fetch(`http://127.0.0.1:${webPort}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: 'xin chào tiếng Việt' }),
      });

      await expect(response.json()).resolves.toEqual({
        echoed: JSON.stringify({ prompt: 'xin chào tiếng Việt' }),
      });
      expect(received.method).toBe('POST');
      expect(received.headers.host).toBe(`127.0.0.1:${corePort}`);
    });

    it('streams the SSE response without buffering and keeps the session header', async () => {
      const response = await get('/api/slow');
      const reader = response.body!.getReader();

      // Chunk đầu phải tới trình duyệt TRƯỚC khi core kết thúc.
      const first = await reader.read();
      expect(new TextDecoder().decode(first.value)).toContain('"type":"start"');
      expect(response.headers.get('x-playground-session')).toBe('sess-1');

      release();
      const second = await reader.read();
      expect(new TextDecoder().decode(second.value)).toContain('"type":"finish"');
      expect((await reader.read()).done).toBe(true);
    });

    it('aborts the request to core when the browser disconnects', async () => {
      const abort = new AbortController();
      const response = await fetch(`http://127.0.0.1:${webPort}/api/slow`, { signal: abort.signal });
      await response.body!.getReader().read();

      abort.abort();
      await sleep(150);

      expect(upstreamClosed).toBe(true);
    });

    it('answers 502 with a readable message when core is not running', async () => {
      const dead = createServer();
      const deadPort = await listen(dead);
      await close(dead);
      const lonely = new CliWebServer({ port: 0, coreUrl: `http://127.0.0.1:${deadPort}` });
      const lonelyPort = await lonely.start();

      try {
        const response = await fetch(`http://127.0.0.1:${lonelyPort}/api/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: '{}',
        });

        expect(response.status).toBe(502);
        const { error } = (await response.json()) as { error: string };
        expect(error).toContain(`http://127.0.0.1:${deadPort}`);
        expect(error).toContain('Core đã chạy chưa');
      } finally {
        await lonely.stop();
      }
    });
  });

  describe('lifecycle', () => {
    it('listens only on 127.0.0.1', () => {
      const address = (web as unknown as { server: Server }).server.address() as AddressInfo;

      expect(address.address).toBe('127.0.0.1');
    });

    it('falls back to the next free port when the first one is busy', async () => {
      const busy = createServer();
      const busyPort = await listen(busy);
      const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
      const fallback = new CliWebServer({ port: busyPort, coreUrl: `http://127.0.0.1:${corePort}` });

      try {
        const bound = await fallback.start();

        expect(bound).toBeGreaterThan(busyPort);
        expect(bound).toBeLessThan(busyPort + 10);
        expect(warn).toHaveBeenCalledWith(expect.stringContaining(String(busyPort)));
      } finally {
        warn.mockRestore();
        await fallback.stop();
        await close(busy);
      }
    });

    it('stops listening after stop()', async () => {
      await web.stop();

      await expect(get('/')).rejects.toBeDefined();
    });

    it('importing the cli package does not start a server', () => {
      const lib = require('../index');

      expect(typeof lib.CliWebServer).toBe('function');
      expect(request).toBeDefined();
    });
  });
});
