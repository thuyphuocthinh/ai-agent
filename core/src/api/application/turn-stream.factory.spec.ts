import type { UIMessageChunk } from 'ai';
import { CACHE, EMessageRole } from '@agent/core/constants';
import { IChatSession } from '../../contracts';
import { AgentStreamService } from '../../engine/streaming/agent-stream.service';
import { MessageClientService } from '../../engine/streaming/message-client.service';
import { AgentCancellationService } from '../../engine/cancellation/agent-cancellation.service';
import { RedisPubSubStreamService } from '../../infrastructure/redis/redis-pubsub-stream.service';
import { TurnStreamFactory } from './turn-stream.factory';

describe('TurnStreamFactory', () => {
  let agentStream: AgentStreamService;
  let messages: MessageClientService;
  let cancellation: jest.Mocked<AgentCancellationService>;
  let pubSub: jest.Mocked<RedisPubSubStreamService>;
  let session: IChatSession;

  beforeEach(() => {
    agentStream = new AgentStreamService();
    messages = new MessageClientService();
    cancellation = {
      requestCancel: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<AgentCancellationService>;

    pubSub = {
      subscribe: jest.fn(),
      publish: jest.fn(),
    } as unknown as jest.Mocked<RedisPubSubStreamService>;

    session = {
      id: 'session-123',
      conversationId: 'conv-123',
      userId: 'user-123',
      tenantId: 'tenant-123',
      botUserId: 'bot-123',
      approvalMessageIds: new Set<string>(),
      createdAt: new Date(),
      lastSeenAt: new Date(),
    };
  });

  afterEach(async () => {
    await agentStream.onModuleDestroy();
  });

  const readAll = async (stream: ReadableStream<UIMessageChunk>) => {
    const chunks: UIMessageChunk[] = [];
    const reader = stream.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
    }
    return chunks;
  };

  it('operates normally without pubSub injected (local fallback mode)', async () => {
    const factory = new TurnStreamFactory(agentStream, messages, cancellation);
    const turn = factory.createTurn(session);

    // Simulate reply message
    const reply = await messages.createMessage({
      channelId: session.conversationId,
      content: 'Hello local world',
    });

    await agentStream.emitStep(
      {
        userId: session.userId,
        channelId: session.conversationId,
        messageId: reply.id,
      },
      { type: 'done' },
    );

    const chunks = await readAll(turn.stream);
    expect(chunks.some((c) => c.type === 'finish')).toBe(true);
  });

  it('subscribes to Redis Pub/Sub stream when reply message is created', async () => {
    let pubSubCallback: ((payload: any) => void) | undefined;
    const unsubMock = jest.fn().mockResolvedValue(undefined);

    pubSub.subscribe.mockImplementation(async (_channel, callback) => {
      pubSubCallback = callback;
      return unsubMock;
    });

    const factory = new TurnStreamFactory(
      agentStream,
      messages,
      cancellation,
      pubSub,
    );
    const turn = factory.createTurn(session);

    const reply = await messages.createMessage({
      channelId: session.conversationId,
      content: '🤖 Đang xử lý...',
    });

    const expectedChannel = CACHE.ORCHESTRATION.KEYS.STREAM_CHANNEL(reply.id);
    expect(pubSub.subscribe).toHaveBeenCalledWith(
      expectedChannel,
      expect.any(Function),
    );

    // Simulate step received from Redis Pub/Sub
    pubSubCallback!({
      context: {
        userId: session.userId,
        channelId: session.conversationId,
        messageId: reply.id,
      },
      step: { type: 'token', text: 'Distributed token' },
    });

    pubSubCallback!({
      context: {
        userId: session.userId,
        channelId: session.conversationId,
        messageId: reply.id,
      },
      step: { type: 'done' },
    });

    const chunks = await readAll(turn.stream);
    const textChunk = chunks.find((c) => c.type === 'text-delta');
    expect(textChunk).toMatchObject({ delta: 'Distributed token' });

    // Ensure unsubscribe cleanup was invoked on turn close
    expect(unsubMock).toHaveBeenCalled();
  });

  it('subscribes immediately if boundMessageId is provided', async () => {
    pubSub.subscribe.mockResolvedValue(jest.fn().mockResolvedValue(undefined));

    const factory = new TurnStreamFactory(
      agentStream,
      messages,
      cancellation,
      pubSub,
    );
    const boundId = 'approval-msg-999';
    factory.createTurn(session, boundId);

    expect(pubSub.subscribe).toHaveBeenCalledWith(
      CACHE.ORCHESTRATION.KEYS.STREAM_CHANNEL(boundId),
      expect.any(Function),
    );
  });
});
