import { BullModule } from '@nestjs/bullmq';
import { DynamicModule, Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EQueueName } from '../../constants';
import { QueueService } from './queue.service';
import {
  IQueueDispatcher,
  QUEUE_DISPATCHER,
} from './queue-dispatcher.interface';
import { BullMqQueueDispatcher } from './bullmq-queue-dispatcher';
import { InMemoryQueueDispatcher } from './in-memory-queue-dispatcher';

const QUEUE_PROVIDERS = [
  QueueService,
  BullMqQueueDispatcher,
  InMemoryQueueDispatcher,
  {
    provide: QUEUE_DISPATCHER,
    inject: [ConfigService, BullMqQueueDispatcher, InMemoryQueueDispatcher],
    useFactory: (
      config: ConfigService,
      bullMq: BullMqQueueDispatcher,
      inMemory: InMemoryQueueDispatcher,
    ): IQueueDispatcher => {
      const driver = config.get<string>('QUEUE_DRIVER');
      const redisHost = config.get<string>('REDIS_HOST');
      if (driver === 'memory' || redisHost === 'memory' || !redisHost) {
        return inMemory;
      }
      return bullMq;
    },
  },
];

@Global()
@Module({
  providers: QUEUE_PROVIDERS,
  exports: [QUEUE_DISPATCHER, QueueService, BullMqQueueDispatcher, InMemoryQueueDispatcher],
})
export class QueueModule {
  static forRoot(): DynamicModule {
    return {
      module: QueueModule,
      imports: [
        BullModule.forRootAsync({
          inject: [ConfigService],
          useFactory: (configService: ConfigService) => ({
            connection: {
              host:
                configService.get<string>('BULLMQ_HOST') ||
                configService.get<string>('REDIS_HOST', '127.0.0.1'),
              port:
                configService.get<number>('BULLMQ_PORT') ||
                configService.get<number>('REDIS_PORT', 6379),
              username:
                configService.get<string>('BULLMQ_USERNAME') ||
                configService.get<string>('REDIS_USERNAME'),
              password:
                configService.get<string>('BULLMQ_PASSWORD') ||
                configService.get<string>('REDIS_PASSWORD'),
            },
          }),
        }),
      ],
      exports: [BullModule, QUEUE_DISPATCHER, QueueService, BullMqQueueDispatcher, InMemoryQueueDispatcher],
    };
  }

  static forFeature(queues: EQueueName[]): DynamicModule {
    const bullQueues = BullModule.registerQueue(
      ...queues.map((name) => ({
        name,
        defaultJobOptions: {
          attempts: 3,
          backoff: {
            type: 'exponential',
            delay: 1000,
          },
          removeOnComplete: true,
          removeOnFail: {
            age: 24 * 3600,
          },
        },
      })),
    );

    return {
      module: QueueModule,
      imports: [bullQueues],
      exports: [bullQueues],
    };
  }
}
