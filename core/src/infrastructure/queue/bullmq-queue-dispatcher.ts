import { Injectable, Logger } from '@nestjs/common';
import { JobsOptions } from 'bullmq';
import { EQueueName } from '../../constants/queue.constant';
import { TJobData } from './job-data.interface';
import {
  DispatchResult,
  IQueueDispatcher,
} from './queue-dispatcher.interface';
import { QueueService } from './queue.service';

@Injectable()
export class BullMqQueueDispatcher implements IQueueDispatcher {
  private readonly logger = new Logger(BullMqQueueDispatcher.name);

  constructor(private readonly queueService: QueueService) {}

  async dispatch<T extends keyof TJobData>(
    queueName: EQueueName,
    jobName: T,
    data: TJobData[T],
    options?: JobsOptions,
  ): Promise<DispatchResult> {
    const job = await this.queueService.addJob(
      queueName,
      jobName,
      data,
      options,
    );
    return { id: String(job.id) };
  }

  async getJobCounts(queueName: EQueueName): Promise<Record<string, number>> {
    return this.queueService.getJobCounts(queueName);
  }
}
