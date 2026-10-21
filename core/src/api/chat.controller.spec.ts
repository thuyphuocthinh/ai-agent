import { INestApplication, NotFoundException, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { UIMessageChunk } from 'ai';
import { ChatController } from './chat.controller';
import { ChatService, TurnStream } from './chat.service';

const SESSION = '5f1d6a0e-8b0c-4a53-9d0b-1c2d3e4f5a6b';
const MESSAGE = '9a8b7c6d-1e2f-4a3b-8c4d-5e6f7a8b9c0d';

const finishedTurn = (chunks: UIMessageChunk[]): TurnStream => ({
  sessionId: SESSION,
  stream: new ReadableStream<UIMessageChunk>({
    start(controller) {
      chunks.forEach((c) => controller.enqueue(c));
      controller.close();
    },
  }),
  cancel: jest.fn().mockResolvedValue(undefined),
});

describe('ChatController', () => {
  const service = { chat: jest.fn(), approve: jest.fn(), history: jest.fn() };
  let app: INestApplication;
  let base: string;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [ChatController],
      providers: [{ provide: ChatService, useValue: service }],
    }).compile();
    app = module.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ transform: true }));
    await app.listen(0, '127.0.0.1');
    base = await app.getUrl();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => jest.clearAllMocks());

  const post = (path: string, body: unknown) =>
    fetch(`${base}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

  describe('POST /api/chat', () => {
    it('streams the UI message stream with the session header and passes the trimmed prompt', async () => {
      service.chat.mockResolvedValue(
        finishedTurn([{ type: 'start', messageId: 'm1' }, { type: 'finish', finishReason: 'stop' }]),
      );

      const response = await post('/api/chat', { prompt: '  xin chào  ', sessionId: SESSION });
      const text = await response.text();

      expect(response.status).toBe(200);
      expect(response.headers.get('x-vercel-ai-ui-message-stream')).toBe('v1');
      expect(response.headers.get('x-playground-session')).toBe(SESSION);
      expect(text).toContain('data: {"type":"start","messageId":"m1"}');
      expect(text).toContain('data: {"type":"finish","finishReason":"stop"}');
      expect(text).toContain('data: [DONE]');
      expect(service.chat).toHaveBeenCalledWith('xin chào', SESSION);
    });

    it.each([
      ['an empty prompt', { prompt: '' }],
      ['a blank prompt', { prompt: '   ' }],
      ['a missing prompt', {}],
      ['a non-string prompt', { prompt: 42 }],
      ['a session id that is not a UUID', { prompt: 'hi', sessionId: 'abc' }],
    ])('answers 400 for %s without calling the engine', async (_label, body) => {
      const response = await post('/api/chat', body);

      expect(response.status).toBe(400);
      expect(service.chat).not.toHaveBeenCalled();
    });

    it('cancels the turn when the client disconnects mid-stream', async () => {
      const turn: TurnStream = {
        sessionId: SESSION,
        cancel: jest.fn().mockResolvedValue(undefined),
        stream: new ReadableStream<UIMessageChunk>({
          start(controller) {
            controller.enqueue({ type: 'start', messageId: 'm1' }); // không bao giờ đóng
          },
        }),
      };
      service.chat.mockResolvedValue(turn);
      const abort = new AbortController();

      const response = await fetch(`${base}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: 'chậm' }),
        signal: abort.signal,
      });
      await response.body!.getReader().read();
      abort.abort();

      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(turn.cancel).toHaveBeenCalledTimes(1);
    });
  });

  describe('POST /api/approve', () => {
    it('streams the resumed turn and passes the decision to the service', async () => {
      service.approve.mockResolvedValue(finishedTurn([{ type: 'finish', finishReason: 'stop' }]));

      const response = await post('/api/approve', { sessionId: SESSION, messageId: MESSAGE, action: 'approve' });
      await response.text();

      expect(response.status).toBe(200);
      expect(service.approve).toHaveBeenCalledWith(SESSION, MESSAGE, 'approve');
    });

    it.each([
      ['an invalid action', { sessionId: SESSION, messageId: MESSAGE, action: 'delete' }],
      ['a missing message id', { sessionId: SESSION, action: 'approve' }],
      ['an invalid session id', { sessionId: 'x', messageId: MESSAGE, action: 'approve' }],
    ])('answers 400 for %s', async (_label, body) => {
      const response = await post('/api/approve', body);

      expect(response.status).toBe(400);
      expect(service.approve).not.toHaveBeenCalled();
    });

    it('turns an HTTP error of the service into a JSON error response', async () => {
      service.approve.mockRejectedValue(new NotFoundException('Phiên không tồn tại'));

      const response = await post('/api/approve', { sessionId: SESSION, messageId: MESSAGE, action: 'reject' });

      expect(response.status).toBe(404);
      await expect(response.json()).resolves.toMatchObject({ message: 'Phiên không tồn tại' });
    });
  });

  describe('GET /api/history', () => {
    it('returns the turns of the session', async () => {
      service.history.mockResolvedValue([{ role: 'user', text: 'hi' }]);

      const response = await fetch(`${base}/api/history?sessionId=${SESSION}`);

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({ turns: [{ role: 'user', text: 'hi' }] });
      expect(service.history).toHaveBeenCalledWith(SESSION);
    });

    it('works without a session and rejects an invalid one', async () => {
      service.history.mockResolvedValue([]);

      expect((await fetch(`${base}/api/history`)).status).toBe(200);
      expect((await fetch(`${base}/api/history?sessionId=nope`)).status).toBe(400);
    });
  });
});
