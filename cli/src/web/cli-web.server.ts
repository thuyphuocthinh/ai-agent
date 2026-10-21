import {
  createServer,
  request as httpRequest,
  IncomingMessage,
  Server,
  ServerResponse,
} from 'http';
import { AddressInfo } from 'net';
import { PLAYGROUND_HTML } from './playground.page';

export const DEFAULT_WEB_PORT = 3001;
export const DEFAULT_CORE_URL = 'http://127.0.0.1:3000';
const PORT_ATTEMPTS = 10;
const HOST = '127.0.0.1';

export interface CliWebServerOptions {
  /** Cổng bắt đầu thử (mặc định 3001); bận thì thử cổng kế tiếp. */
  port?: number;
  /** Địa chỉ core (mặc định `CORE_URL` hoặc http://127.0.0.1:3000). */
  coreUrl?: string;
}

/**
 * Server web nhỏ của CLI: phục vụ trang playground và chuyển tiếp `/api/*` sang
 * core (core mới là nơi chứa engine). Chỉ dùng Node `http`.
 */
export class CliWebServer {
  private server?: Server;
  private readonly core: URL;

  constructor(private readonly options: CliWebServerOptions = {}) {
    this.core = new URL(options.coreUrl ?? process.env.CORE_URL ?? DEFAULT_CORE_URL);
  }

  /** Khởi động và trả về cổng thực sự đang nghe. */
  async start(): Promise<number> {
    const first = this.options.port ?? DEFAULT_WEB_PORT;
    for (let port = first; port < first + PORT_ATTEMPTS; port++) {
      try {
        const bound = await this.listen(port);
        if (port !== first) {
          console.warn(`⚠️  Cổng ${first} đang bận, dùng cổng ${port}.`);
        }
        return bound;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EADDRINUSE') throw error;
      }
    }
    throw new Error(
      `Không tìm được cổng trống từ ${first} đến ${first + PORT_ATTEMPTS - 1}`,
    );
  }

  async stop(): Promise<void> {
    const server = this.server;
    this.server = undefined;
    if (!server) return;
    server.closeAllConnections?.();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  private listen(port: number): Promise<number> {
    return new Promise((resolve, reject) => {
      const server = createServer((req, res) => this.handle(req, res));
      server.once('error', reject);
      server.listen(port, HOST, () => {
        server.off('error', reject);
        this.server = server;
        resolve((server.address() as AddressInfo).port);
      });
    });
  }

  private handle(req: IncomingMessage, res: ServerResponse): void {
    const path = (req.url ?? '/').split('?')[0];

    if (path.startsWith('/api/')) {
      this.proxy(req, res);
      return;
    }
    if (req.method === 'GET' && (path === '/' || path === '/index.html')) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(PLAYGROUND_HTML);
      return;
    }
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
  }

  /** Chuyển tiếp nguyên vẹn (stream, không đệm) sang core; trình duyệt đóng thì huỷ request tới core. */
  private proxy(req: IncomingMessage, res: ServerResponse): void {
    const upstream = httpRequest(
      {
        hostname: this.core.hostname,
        port: this.core.port,
        method: req.method,
        path: req.url,
        headers: { ...req.headers, host: this.core.host },
      },
      (coreResponse) => {
        res.writeHead(coreResponse.statusCode ?? 502, coreResponse.headers);
        res.flushHeaders();
        coreResponse.pipe(res);
      },
    );

    upstream.on('error', (error: NodeJS.ErrnoException) => {
      if (res.headersSent) {
        res.destroy();
        return;
      }
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          error: `Không kết nối được core ở ${this.core.origin} (${error.code ?? error.message}). Core đã chạy chưa?`,
        }),
      );
    });
    res.on('close', () => {
      if (!res.writableFinished) upstream.destroy();
    });
    req.pipe(upstream);
  }
}
