import { Injectable, Optional } from '@nestjs/common';
import type { UIMessageChunk } from 'ai';
import { EMessageRole, CACHE, ECheckpointKind } from '@agent/core/constants';
import {
  ActiveTurn,
  AgentStreamService,
  IChatSession,
  MessageClientService,
  MessageEvent,
  VercelUiStreamAdapter,
} from '../../contracts';
import { AgentCancellationService } from '../../engine/cancellation/agent-cancellation.service';
import { RedisPubSubStreamService } from '../../infrastructure/redis/redis-pubsub-stream.service';

export const TURN_TIMEOUT_MS = 5 * 60 * 1000;

@Injectable()
export class TurnStreamFactory {
  constructor(
    private readonly agentStream: AgentStreamService,
    private readonly messages: MessageClientService,
    private readonly cancellation: AgentCancellationService,
    @Optional()
    private readonly pubSub?: RedisPubSubStreamService,
  ) {}

  createTurn(session: IChatSession, boundMessageId?: string): ActiveTurn {
    let controller!: ReadableStreamDefaultController<UIMessageChunk>;
    let closed = false;
    const cleanups: Array<() => void> = [];
    const subscribedChannels = new Set<string>();

    const release = () => {
      closed = true;
      cleanups.splice(0).forEach((fn) => fn());
    };

    const close = () => {
      if (closed) return;
      release();
      try {
        controller.close();
      } catch {
        // stream đã đóng
      }
    };

    const adapter = new VercelUiStreamAdapter({
      messageId: boundMessageId,
      write: (chunk) => {
        if (closed) return;
        controller.enqueue(chunk);
        if (chunk.type === 'finish') close();
      },
    });

    const subscribeToMessageChannel = (msgId: string) => {
      if (!this.pubSub || subscribedChannels.has(msgId)) return;
      subscribedChannels.add(msgId);
      const channel = CACHE.ORCHESTRATION.KEYS.STREAM_CHANNEL(msgId);
      this.pubSub
        .subscribe(channel, (payload: any) => {
          if (closed) return;
          if (payload?.step && payload?.context) {
            adapter.handle(payload.context, payload.step);
          }
        })
        .then((unsub) => {
          cleanups.push(() => {
            void unsub();
          });
        })
        .catch(() => {});
    };

    const stream = new ReadableStream<UIMessageChunk>({
      start: (c) => {
        controller = c;
      },
      cancel: () => release(),
    });

    cleanups.push(adapter.attach(this.agentStream));
    cleanups.push(
      this.messages.onMessage((event) =>
        this.handleMessage(event, session, adapter, subscribeToMessageChannel),
      ),
    );

    if (boundMessageId) {
      subscribeToMessageChannel(boundMessageId);
    }

    const fail = async (error: unknown) => {
      if (closed) return;
      await adapter.flush();
      if (closed) return;
      if (!adapter.finished) {
        controller.enqueue({
          type: 'error',
          errorText: String((error as Error)?.message ?? error),
        });
        controller.enqueue({ type: 'finish', finishReason: 'error' });
      }
      close();
    };

    const timer = setTimeout(
      () => void fail(new Error('Quá thời gian chờ phản hồi của engine')),
      TURN_TIMEOUT_MS,
    );
    timer.unref?.();
    cleanups.push(() => clearTimeout(timer));

    const cancel = async () => {
      if (closed) return;
      const replyId = adapter.boundMessageId;
      const alreadyFinished = adapter.finished;
      close();
      if (replyId && !alreadyFinished) {
        await this.cancellation.requestCancel(replyId).catch(() => undefined);
      }
    };

    return { stream, close, fail, cancel };
  }

  private handleMessage(
    event: MessageEvent,
    session: IChatSession,
    adapter: VercelUiStreamAdapter,
    subscribeChannel?: (msgId: string) => void,
  ): void {
    if (
      event.conversationId !== session.conversationId ||
      event.role !== EMessageRole.MODEL
    ) {
      return;
    }

    if (event.type === 'created') {
      if (
        typeof event.content === 'object' &&
        event.content.type === 'approval_request'
      ) {
        session.approvalMessageIds.add(event.id);
        adapter.send({
          type: 'data-approval',
          data: {
            messageId: event.id,
            tool: event.content.tool,
            preview: event.content.preview,
            friendlySummary: (event.content as Record<string, unknown>)
              .friendlySummary,
          },
        });
        return;
      }
      if (
        typeof event.content === 'object' &&
        event.content.type === 'clarification_request'
      ) {
        session.approvalMessageIds.add(event.id);
        const content = event.content as Record<string, unknown>;
        adapter.send({
          type: 'data-clarification',
          data: {
            messageId: event.id,
            kind: ECheckpointKind.CLARIFICATION,
            preview: content.question,
            friendlySummary: content.question,
            candidates: content.candidates,
          },
        });
        return;
      }
      // Message đầu tiên engine tạo cho turn là reply: từ đây mới biết id để lọc event.
      adapter.bind(event.id);
      if (subscribeChannel) {
        subscribeChannel(event.id);
      }
      return;
    }

    // Câu trả lời cuối và lỗi của engine chỉ đi qua updateMessage, không đi qua stream.
    if (
      event.id === adapter.boundMessageId &&
      typeof event.content === 'string'
    ) {
      adapter.send({
        type: 'data-reply',
        data: { messageId: event.id, text: event.content },
      });
    }
  }
}
