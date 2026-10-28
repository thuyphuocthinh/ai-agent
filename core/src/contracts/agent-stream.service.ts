import { Inject, Injectable, Logger, OnModuleDestroy, Optional } from '@nestjs/common';
import { EAgentStreamStepType, CACHE } from '@agent/core/constants';
import {
  AgentStreamContext,
  AgentStreamStep,
  DEFAULT_STREAM_KEY,
  IStreamSink,
} from './stream-sink.interface';
import { RedisPubSubStreamService } from '../infrastructure/redis/redis-pubsub-stream.service';
import { ITurnEventLog, TURN_EVENT_LOG } from './turn-event-log.interface';

const TOKEN_BATCH_FLUSH_MS = 50;

interface PendingTokenBatch {
  text: string;
  context: AgentStreamContext;
  timer: NodeJS.Timeout;
}

@Injectable()
export class AgentStreamService implements IStreamSink, OnModuleDestroy {
  private readonly logger = new Logger(AgentStreamService.name);
  private readonly pendingTokenBatches = new Map<string, PendingTokenBatch>();
  private readonly listeners: ((
    context: AgentStreamContext,
    step: AgentStreamStep,
  ) => void)[] = [];

  constructor(
    @Optional()
    private readonly pubSub?: RedisPubSubStreamService,
    @Optional()
    @Inject(TURN_EVENT_LOG)
    private readonly eventLog?: ITurnEventLog,
  ) { }

  onStep(
    listener: (context: AgentStreamContext, step: AgentStreamStep) => void,
  ): () => void {
    this.listeners.push(listener);
    return () => {
      const idx = this.listeners.indexOf(listener);
      if (idx !== -1) this.listeners.splice(idx, 1);
    };
  }

  async emitStep(
    context: AgentStreamContext,
    step: AgentStreamStep,
  ): Promise<void> {
    const key = this.batchKey(context);

    if (step.type === EAgentStreamStepType.TOKEN) {
      this.bufferToken(key, context, step.text ?? '');
      return;
    }

    this.drainPendingBatch(key);
    for (const listener of this.listeners) {
      try {
        listener(context, step);
      } catch (err: unknown) {
        this.logger.warn(`Listener error: ${(err as Error)?.message}`);
      }
    }

    if (this.pubSub && context.messageId) {
      const channel = CACHE.ORCHESTRATION.KEYS.STREAM_CHANNEL(context.messageId);
      void this.pubSub.publish(channel, { context, step });
    }

    this.appendToLog(context, step);
  }

  async emitToken(context: AgentStreamContext, token: string): Promise<void> {
    await this.emitStep(context, {
      type: EAgentStreamStepType.TOKEN,
      text: token,
    });
  }

  async flush(): Promise<void> {
    for (const key of [...this.pendingTokenBatches.keys()]) {
      this.drainPendingBatch(key);
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.flush();
  }

  private batchKey(context: AgentStreamContext): string {
    return `${context.messageId}:${context.streamKey ?? DEFAULT_STREAM_KEY}`;
  }

  private bufferToken(
    key: string,
    context: AgentStreamContext,
    text: string,
  ): void {
    const existing = this.pendingTokenBatches.get(key);
    if (existing) {
      existing.text += text;
      return;
    }
    const timer = setTimeout(() => {
      this.drainPendingBatch(key);
    }, TOKEN_BATCH_FLUSH_MS);
    this.pendingTokenBatches.set(key, { text, context, timer });
  }

  private drainPendingBatch(key: string): void {
    const batch = this.pendingTokenBatches.get(key);
    if (!batch) return;
    clearTimeout(batch.timer);
    this.pendingTokenBatches.delete(key);
    const step: AgentStreamStep = { type: EAgentStreamStepType.TOKEN, text: batch.text };
    for (const listener of this.listeners) {
      try {
        listener(batch.context, step);
      } catch (err: unknown) {
        this.logger.warn(`Listener error: ${(err as Error)?.message}`);
      }
    }

    if (this.pubSub && batch.context.messageId) {
      const channel = CACHE.ORCHESTRATION.KEYS.STREAM_CHANNEL(
        batch.context.messageId,
      );
      void this.pubSub.publish(channel, { context: batch.context, step });
    }

    this.appendToLog(batch.context, step);
  }

  // Ghi vào event log theo turn để reload/reconnect phát lại được. Fire-and-forget:
  // lệnh Redis được gửi đồng bộ ngay đây nên thứ tự gọi = thứ tự trong log.
  private appendToLog(context: AgentStreamContext, step: AgentStreamStep): void {
    if (!this.eventLog || !context.messageId) return;
    void this.eventLog.appendStep(context.messageId, context, step);
  }
}
