import { Inject, Injectable, Optional } from '@nestjs/common';
import type { UIMessageChunk } from 'ai';
import {
  EAgentStreamStepType,
  EMessageEventType,
  EMessageRole,
  EVercelStreamChunkType,
  CACHE,
} from '@agent/core/constants';
import {
  ActiveTurn,
  AgentStreamService,
  IChatSession,
  ETurnLogEntryKind,
  ITurnEventLog,
  MessageClientService,
  MessageEvent,
  TURN_EVENT_LOG,
  VercelUiStreamAdapter,
} from '../../contracts';
import { messageEventToChunk } from '../../contracts/message-event-chunk';
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
    @Optional()
    @Inject(TURN_EVENT_LOG)
    private readonly eventLog?: ITurnEventLog,
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
        if (chunk.type === EVercelStreamChunkType.FINISH) close();
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
          type: EVercelStreamChunkType.ERROR,
          errorText: String((error as Error)?.message ?? error),
        });
        controller.enqueue({ type: EVercelStreamChunkType.FINISH, finishReason: 'error' });
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

  /**
   * Stream tái kết nối: phát lại event log của turn TỪ ĐẦU qua 1 adapter mới (adapter
   * tất định nên ra đúng chuỗi chunk như lúc stream live) rồi bám theo phần đuôi cho
   * đến khi turn kết thúc. Không có snapshot/pub-sub nên không có khoảng hở: không
   * mất và không lặp event. Client chỉ cần vẽ lại turn từ stream như bình thường.
   */
  createReplayTurn(session: IChatSession, messageId: string): ActiveTurn {
    const log = this.eventLog;
    if (!log) {
      throw new Error('Turn event log không khả dụng (cần Redis thật)');
    }

    let controller!: ReadableStreamDefaultController<UIMessageChunk>;
    let closed = false;
    const abort = new AbortController();

    const close = () => {
      if (closed) return;
      closed = true;
      abort.abort();
      clearTimeout(timer);
      try {
        controller.close();
      } catch {
        // stream đã đóng
      }
    };

    const adapter = new VercelUiStreamAdapter({
      messageId,
      write: (chunk) => {
        if (closed) return;
        controller.enqueue(chunk);
        if (chunk.type === EVercelStreamChunkType.FINISH) close();
      },
    });

    // Kết thúc stream cho client: lỗi → error + finish; log hết mà chưa có `done`
    // (VD worker chết) → tự đóng bằng `done` để client không treo.
    const end = async (error?: unknown) => {
      await adapter.flush();
      if (closed) return;
      if (error) {
        if (!adapter.finished) {
          controller.enqueue({
            type: EVercelStreamChunkType.ERROR,
            errorText: String((error as Error)?.message ?? error),
          });
          controller.enqueue({ type: EVercelStreamChunkType.FINISH, finishReason: 'error' });
        }
      } else if (!adapter.finished) {
        adapter.handle(
          { userId: session.userId, messageId },
          { type: EAgentStreamStepType.DONE },
        );
        await adapter.flush();
      }
      close();
    };

    const pump = async () => {
      try {
        for await (const entry of log.read(messageId, abort.signal)) {
          if (closed) return;
          if (entry.kind === ETurnLogEntryKind.STEP) {
            adapter.handle(entry.context, entry.step);
          } else {
            adapter.send(entry.chunk);
          }
          if (adapter.finished) break;
        }
        await end();
      } catch (error) {
        await end(error);
      }
    };

    const timer = setTimeout(
      () => void end(new Error('Quá thời gian chờ phản hồi của engine')),
      TURN_TIMEOUT_MS,
    );
    timer.unref?.();

    const stream = new ReadableStream<UIMessageChunk>({
      start: (c) => {
        controller = c;
        void pump();
      },
      cancel: () => {
        closed = true;
        abort.abort();
        clearTimeout(timer);
      },
    });

    const cancel = async () => {
      if (closed) return;
      const alreadyFinished = adapter.finished;
      close();
      if (!alreadyFinished) {
        await this.cancellation.requestCancel(messageId).catch(() => undefined);
      }
    };

    return { stream, close, fail: end, cancel };
  }

  /** Stream đóng sẵn gồm đúng các chunk cho trước (turn đã xong, log đã hết hạn). */
  createStaticTurn(chunks: UIMessageChunk[]): ActiveTurn {
    const stream = new ReadableStream<UIMessageChunk>({
      start: (controller) => {
        chunks.forEach((chunk) => controller.enqueue(chunk));
        controller.close();
      },
    });
    return {
      stream,
      close: () => undefined,
      fail: async () => undefined,
      cancel: async () => undefined,
    };
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

    if (event.type === EMessageEventType.CREATED) {
      const chunk = messageEventToChunk(event);
      if (chunk) {
        // Yêu cầu duyệt / làm rõ: ghi nhớ để endpoint approve nhận message này.
        session.approvalMessageIds.add(event.id);
        adapter.send(chunk);
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
    const chunk = messageEventToChunk(event, adapter.boundMessageId);
    if (chunk) {
      adapter.send(chunk);
    }
  }
}
