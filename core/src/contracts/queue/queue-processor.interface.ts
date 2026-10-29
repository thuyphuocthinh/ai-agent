import type { Job } from 'bullmq';
import { EQueueName } from '../../constants/queue.constant';

export interface IQueueProcessor {
  process(job: Job): Promise<unknown>;
}

export type TQueueProcessorMap = Partial<Record<EQueueName, IQueueProcessor>>;

/**
 * Token để InMemoryQueueDispatcher (infrastructure) tra processor theo tên queue
 * mà không phải import trực tiếp các processor của engine.
 */
export const QUEUE_PROCESSORS = Symbol.for('QUEUE_PROCESSORS');
