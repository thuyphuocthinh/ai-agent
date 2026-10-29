import { Injectable, Logger } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { randomUUID } from 'crypto';
import { JobsOptions } from 'bullmq';
import { EQueueName, EJobName } from '../../constants/queue.constant';
import { TJobData } from '../../contracts/queue/job-data.interface';
import {
  QUEUE_PROCESSORS,
  TQueueProcessorMap,
} from '../../contracts/queue/queue-processor.interface';
import {
  DispatchResult,
  IQueueDispatcher,
} from './queue-dispatcher.interface';

export type JobHandler<T = any> = (data: T) => Promise<any>;

@Injectable()
export class InMemoryQueueDispatcher implements IQueueDispatcher {
  private readonly logger = new Logger(InMemoryQueueDispatcher.name);
  private readonly handlers = new Map<string, JobHandler>();
  private activeCount = 0;

  constructor(private readonly moduleRef: ModuleRef) {}

  registerHandler(
    queueName: EQueueName,
    jobName: string,
    handler: JobHandler,
  ): void {
    this.handlers.set(`${queueName}:${jobName}`, handler);
  }

  async dispatch<T extends keyof TJobData>(
    queueName: EQueueName,
    jobName: T,
    data: TJobData[T],
    _options?: JobsOptions,
  ): Promise<DispatchResult> {
    const id = randomUUID();
    this.activeCount++;

    setImmediate(async () => {
      try {
        const customHandler = this.handlers.get(`${queueName}:${jobName}`);
        if (customHandler) {
          await customHandler(data);
          return;
        }

        await this.resolveAndExecute(queueName, jobName as string, data, id);
      } catch (err: any) {
        this.logger.error(
          `InMemory job ${jobName} [${id}] failed: ${err?.message}`,
          err?.stack,
        );
      } finally {
        this.activeCount = Math.max(0, this.activeCount - 1);
      }
    });

    return { id };
  }

  async getJobCounts(
    _queueName: EQueueName,
  ): Promise<Record<string, number>> {
    return {
      waiting: 0,
      active: this.activeCount,
    };
  }

  private async resolveAndExecute(
    queueName: EQueueName,
    jobName: string,
    data: any,
    id: string,
  ): Promise<void> {
    const mockJob = {
      id,
      name: jobName,
      data,
    };

    try {
      const processors = this.moduleRef.get<TQueueProcessorMap>(QUEUE_PROCESSORS, {
        strict: false,
      });
      const processor = processors?.[queueName];
      if (processor) {
        await processor.process(mockJob as any);
        return;
      }
    } catch (err: any) {
      this.logger.warn(
        `Could not resolve processor for queue ${queueName}: ${err?.message}`,
      );
    }

    this.logger.warn(
      `No processor or handler registered for in-memory job ${queueName}:${jobName}`,
    );
  }
}
