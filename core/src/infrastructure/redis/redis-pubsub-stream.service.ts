import { Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';

@Injectable()
export class RedisPubSubStreamService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisPubSubStreamService.name);
  private subClient: Redis | null = null;
  private readonly channelHandlers = new Map<
    string,
    Set<(payload: any) => void>
  >();

  constructor(
    @Inject('REDIS_CLIENT')
    private readonly pubClient: Redis,
  ) {}

  async publish(channel: string, payload: any): Promise<number> {
    try {
      const message =
        typeof payload === 'string' ? payload : JSON.stringify(payload);
      return await this.pubClient.publish(channel, message);
    } catch (err: any) {
      this.logger.error(
        `Failed to publish to channel ${channel}: ${err?.message}`,
      );
      return 0;
    }
  }

  async subscribe(
    channel: string,
    handler: (payload: any) => void,
  ): Promise<() => Promise<void>> {
    await this.ensureSubscriber();

    let handlers = this.channelHandlers.get(channel);
    const isFirst = !handlers || handlers.size === 0;

    if (!handlers) {
      handlers = new Set();
      this.channelHandlers.set(channel, handlers);
    }
    handlers.add(handler);

    if (isFirst && this.subClient) {
      try {
        await this.subClient.subscribe(channel);
      } catch (err: any) {
        this.logger.error(
          `Failed to subscribe to Redis channel ${channel}: ${err?.message}`,
        );
      }
    }

    return async () => {
      const currentHandlers = this.channelHandlers.get(channel);
      if (currentHandlers) {
        currentHandlers.delete(handler);
        if (currentHandlers.size === 0) {
          this.channelHandlers.delete(channel);
          if (this.subClient) {
            try {
              await this.subClient.unsubscribe(channel);
            } catch (err: any) {
              this.logger.warn(
                `Failed to unsubscribe from channel ${channel}: ${err?.message}`,
              );
            }
          }
        }
      }
    };
  }

  private async ensureSubscriber(): Promise<void> {
    if (this.subClient) return;

    if (typeof this.pubClient.duplicate === 'function') {
      this.subClient = this.pubClient.duplicate();
    } else {
      this.subClient = this.pubClient;
    }

    this.subClient.on('message', (channel: string, message: string) => {
      const handlers = this.channelHandlers.get(channel);
      if (!handlers || handlers.size === 0) return;

      let parsed: any;
      try {
        parsed = JSON.parse(message);
      } catch {
        parsed = message;
      }

      for (const handler of handlers) {
        try {
          handler(parsed);
        } catch (err: any) {
          this.logger.warn(
            `Error in Pub/Sub handler for channel ${channel}: ${err?.message}`,
          );
        }
      }
    });
  }

  async onModuleDestroy(): Promise<void> {
    if (this.subClient && typeof this.subClient.quit === 'function') {
      try {
        await this.subClient.quit();
      } catch {
        // ignore on shutdown
      }
      this.subClient = null;
    }
    this.channelHandlers.clear();
  }
}
