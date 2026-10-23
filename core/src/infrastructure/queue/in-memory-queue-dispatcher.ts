import { Injectable, Logger } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { randomUUID } from 'crypto';
import { JobsOptions } from 'bullmq';
import { EQueueName, EJobName } from '../../constants/queue.constant';
import { TJobData } from './job-data.interface';
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

    if (queueName === EQueueName.AI_ORCHESTRATION_QUEUE) {
      try {
        // Dynamic lookup to avoid circular imports
        const { AiOrchestrationProcessor } = await import(
          '../../engine/orchestrator/ai-orchestration.processor'
        );
        const processor = this.moduleRef.get(AiOrchestrationProcessor, {
          strict: false,
        });
        if (processor) {
          await processor.process(mockJob as any);
          return;
        }
      } catch (err: any) {
        this.logger.warn(`Could not resolve AiOrchestrationProcessor: ${err?.message}`);
      }
    }

    if (queueName === EQueueName.DYNAMIC_PROVIDER_QUEUE) {
      try {
        const { DynamicProviderProcessor } = await import(
          '../../engine/orchestrator/dynamic-provider.processor'
        );
        const processor = this.moduleRef.get(DynamicProviderProcessor, {
          strict: false,
        });
        if (processor) {
          await processor.process(mockJob as any);
          return;
        }
      } catch (err: any) {
        this.logger.warn(`Could not resolve DynamicProviderProcessor: ${err?.message}`);
      }
    }

    this.logger.warn(
      `No processor or handler registered for in-memory job ${queueName}:${jobName}`,
    );
  }
}
