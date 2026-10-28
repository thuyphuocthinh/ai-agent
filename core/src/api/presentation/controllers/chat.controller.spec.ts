import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { UIMessageChunk } from 'ai';
import { TurnStream } from '../../../contracts';
import { ChatController } from './chat.controller';
import { ChatService } from '../../application/chat.service';
import { UiStreamPresenter } from '../presenters/ui-stream.presenter';

const SESSION = '5f1d6a0e-8b0c-4a53-9d0b-1c2d3e4f5a6b';

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
  const service = {
    chat: jest.fn(),
    approve: jest.fn(),
    history: jest.fn(),
    listConversations: jest.fn(),
    reconnectStream: jest.fn(),
  };
  let app: INestApplication;
  let base: string;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [ChatController],
      providers: [
        { provide: ChatService, useValue: service },
        UiStreamPresenter,
      ],
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

    it('closes the stream reader without cancelling background turn when the client disconnects mid-stream', async () => {
      const mockClose = jest.fn();
      const turn: TurnStream = {
        sessionId: SESSION,
        cancel: jest.fn().mockResolvedValue(undefined),
        close: mockClose,
        stream: new ReadableStream<UIMessageChunk>({
          start(controller) {
            controller.enqueue({ type: 'start', messageId: 'm1' });
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
      for (let i = 0; i < 20; i++) {
        if (mockClose.mock.calls.length > 0) break;
        await new Promise((r) => setTimeout(r, 25));
      }
      expect(mockClose).toHaveBeenCalled();
    });
  });

  describe('POST /api/approve', () => {
    it('streams the resumed turn and passes the decision to the service', async () => {
      service.approve.mockResolvedValue(
        finishedTurn([{ type: 'start', messageId: 'm1' }, { type: 'finish', finishReason: 'stop' }]),
      );

      const response = await post('/api/approve', {
        sessionId: SESSION,
        messageId: '9a8b7c6d-1e2f-4a3b-8c4d-5e6f7a8b9c0d',
        action: 'approve',
      });
      const text = await response.text();

      expect(response.status).toBe(200);
      expect(text).toContain('data: [DONE]');
      expect(service.approve).toHaveBeenCalledWith(
        SESSION,
        '9a8b7c6d-1e2f-4a3b-8c4d-5e6f7a8b9c0d',
        'approve',
      );
    });

    it.each([
      ['an invalid action', { sessionId: SESSION, messageId: '9a8b7c6d-1e2f-4a3b-8c4d-5e6f7a8b9c0d', action: 'maybe' }],
      ['a missing message id', { sessionId: SESSION, action: 'approve' }],
      ['an invalid session id', { sessionId: 'not-a-uuid', messageId: '9a8b7c6d-1e2f-4a3b-8c4d-5e6f7a8b9c0d', action: 'approve' }],
    ])('answers 400 for %s without calling the engine', async (_label, body) => {
      const response = await post('/api/approve', body);

      expect(response.status).toBe(400);
      expect(service.approve).not.toHaveBeenCalled();
    });
  });

  describe('GET /api/history', () => {
    it('returns the turns of the session', async () => {
      service.history.mockResolvedValue([{ role: 'user', text: 'hi' }]);

      const response = await fetch(`${base}/api/history?sessionId=${SESSION}`);
      const body = (await response.json()) as { turns: unknown[] };

      expect(response.status).toBe(200);
      expect(body).toEqual({ turns: [{ role: 'user', text: 'hi' }] });
      expect(service.history).toHaveBeenCalledWith(SESSION);
    });

    it('works without a session and rejects an invalid one', async () => {
      service.history.mockResolvedValue([]);

      const empty = await fetch(`${base}/api/history`);
      expect(empty.status).toBe(200);
      expect(service.history).toHaveBeenCalledWith(undefined);

      const bad = await fetch(`${base}/api/history?sessionId=bad`);
      expect(bad.status).toBe(400);
    });
  });

  describe('GET /api/conversations', () => {
    it('trả về danh sách cuộc trò chuyện với cursor pagination', async () => {
      service.listConversations.mockResolvedValue({
        data: [
          {
            id: '01a171ed-5764-75bb-b455-73f7e34aed2b',
            title: 'Hỏi về đơn hàng',
            state: 'AI_ACTIVE',
            lastSeenAt: new Date('2026-10-25T07:19:00Z'),
            createdAt: new Date('2026-10-25T07:19:00Z'),
          },
        ],
        meta: {
          limit: 20,
          nextCursor: undefined,
          hasMore: false,
        },
      });

      const response = await fetch(`${base}/api/conversations?limit=20`);
      const body = (await response.json()) as { data: any[]; meta: any };

      expect(response.status).toBe(200);
      expect(body.data).toHaveLength(1);
      expect(body.data[0].id).toBe('01a171ed-5764-75bb-b455-73f7e34aed2b');
      expect(body.data[0].title).toBe('Hỏi về đơn hàng');
      expect(body.meta.limit).toBe(20);
      expect(body.meta.hasMore).toBe(false);
      expect(service.listConversations).toHaveBeenCalledWith(
        expect.objectContaining({ limit: 20 }),
      );
    });
  });

  describe('GET /api/stream', () => {
    it('pipes the reconnected stream with valid sessionId and messageId', async () => {
      service.reconnectStream.mockResolvedValue(
        finishedTurn([
          {
            type: 'data-resync',
            data: { steps: [], partialText: 'resynced' },
          } as unknown as UIMessageChunk,
          { type: 'finish', finishReason: 'stop' },
        ]),
      );

      const messageId = '018f4a12-873b-7a32-9cb1-3a0e1b234567';
      const response = await fetch(
        `${base}/api/stream?sessionId=${SESSION}&messageId=${messageId}`,
      );
      const text = await response.text();

      expect(response.status).toBe(200);
      expect(response.headers.get('x-playground-session')).toBe(SESSION);
      expect(text).toContain('data-resync');
      expect(text).toContain('resynced');
      expect(service.reconnectStream).toHaveBeenCalledWith(SESSION, messageId);
    });

    it('answers 400 for an invalid UUID sessionId', async () => {
      const response = await fetch(`${base}/api/stream?sessionId=invalid-uuid`);
      expect(response.status).toBe(400);
      expect(service.reconnectStream).not.toHaveBeenCalled();
    });

    it('answers 400 when sessionId is missing', async () => {
      const response = await fetch(`${base}/api/stream`);
      expect(response.status).toBe(400);
      expect(service.reconnectStream).not.toHaveBeenCalled();
    });
  });
});
