import { Module, Global, DynamicModule } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { TURN_EVENT_LOG } from '../../contracts/streaming/turn-event-log.interface';
import { RedisTurnEventLogService } from './redis-turn-event-log.service';
import { CachedService } from './cached.service';
import { RateLimitService } from './rate-limit.service';
import { RedisPubSubStreamService } from './redis-pubsub-stream.service';
import { InMemoryRedisClient } from './in-memory-redis.client';

const PROVIDERS = [
  CachedService,
  RateLimitService,
  RedisPubSubStreamService,
  RedisTurnEventLogService,
  {
    provide: TURN_EVENT_LOG,
    useExisting: RedisTurnEventLogService,
  },
];

@Global()
@Module({
  providers: PROVIDERS,
  exports: PROVIDERS,
})
export class CachedModule {
  static forRoot(): DynamicModule {
    return {
      module: CachedModule,
      providers: [
        {
          provide: 'REDIS_CLIENT',
          inject: [ConfigService],
          useFactory: (configService: ConfigService) => {
            const host = configService.get<string>('REDIS_HOST');
            if (!host || host === 'memory' || host === 'in-memory') {
              return new InMemoryRedisClient() as unknown as Redis;
            }
            return new Redis({
              host,
              port: configService.get<number>('REDIS_PORT', 6379),
              password: configService.get<string>('REDIS_PASSWORD'),
              username: configService.get<string>('REDIS_USERNAME'),
            });
          },
        },
      ],
      exports: ['REDIS_CLIENT', ...PROVIDERS],
    };
  }
}
