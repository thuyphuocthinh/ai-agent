import { JobsOptions } from 'bullmq';
import { EQueueName } from '../../constants/queue.constant';
import { TJobData } from './job-data.interface';

export const QUEUE_DISPATCHER = Symbol('QUEUE_DISPATCHER');

export interface DispatchResult {
  id: string;
}

export interface IQueueDispatcher {
  dispatch<T extends keyof TJobData>(
    queueName: EQueueName,
    jobName: T,
    data: TJobData[T],
    options?: JobsOptions,
  ): Promise<DispatchResult>;

  getJobCounts?(queueName: EQueueName): Promise<Record<string, number>>;
}
