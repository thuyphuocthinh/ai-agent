import { ModuleRef } from '@nestjs/core';
import { EJobName, EQueueName } from '../../constants/queue.constant';
import { BullMqQueueDispatcher } from './bullmq-queue-dispatcher';
import { InMemoryQueueDispatcher } from './in-memory-queue-dispatcher';
import { QueueService } from './queue.service';

describe('QueueDispatchers', () => {
  describe('BullMqQueueDispatcher', () => {
    let queueService: jest.Mocked<QueueService>;
    let dispatcher: BullMqQueueDispatcher;

    beforeEach(() => {
      queueService = {
        addJob: jest.fn(),
        getJobCounts: jest.fn(),
      } as unknown as jest.Mocked<QueueService>;

      dispatcher = new BullMqQueueDispatcher(queueService);
    });

    it('delegates dispatch to QueueService and formats id as string', async () => {
      queueService.addJob.mockResolvedValue({ id: 12345 } as any);

      const result = await dispatcher.dispatch(
        EQueueName.AI_ORCHESTRATION_QUEUE,
        EJobName.PROCESS_AI_TRIGGER,
        {
          userId: 'u1',
          channelId: 'c1',
          conversationId: 'conv1',
          workspaceId: 'w1',
          tenantId: 't1',
          messageId: 'm1',
          botUserId: 'bot1',
        },
      );

      expect(queueService.addJob).toHaveBeenCalledWith(
        EQueueName.AI_ORCHESTRATION_QUEUE,
        EJobName.PROCESS_AI_TRIGGER,
        expect.objectContaining({ userId: 'u1' }),
        undefined,
      );
      expect(result).toEqual({ id: '12345' });
    });

    it('delegates getJobCounts to QueueService', async () => {
      const counts = { waiting: 2, active: 1, completed: 10, failed: 0 };
      queueService.getJobCounts.mockResolvedValue(counts);

      const result = await dispatcher.getJobCounts(
        EQueueName.AI_ORCHESTRATION_QUEUE,
      );

      expect(queueService.getJobCounts).toHaveBeenCalledWith(
        EQueueName.AI_ORCHESTRATION_QUEUE,
      );
      expect(result).toEqual(counts);
    });
  });

  describe('InMemoryQueueDispatcher', () => {
    let moduleRef: jest.Mocked<ModuleRef>;
    let dispatcher: InMemoryQueueDispatcher;

    beforeEach(() => {
      moduleRef = {
        get: jest.fn(),
      } as unknown as jest.Mocked<ModuleRef>;

      dispatcher = new InMemoryQueueDispatcher(moduleRef);
    });

    it('generates a UUID id and returns immediately while processing asynchronously', async () => {
      let executed = false;
      dispatcher.registerHandler(
        EQueueName.AI_ORCHESTRATION_QUEUE,
        EJobName.PROCESS_AI_TRIGGER,
        async () => {
          executed = true;
        },
      );

      const result = await dispatcher.dispatch(
        EQueueName.AI_ORCHESTRATION_QUEUE,
        EJobName.PROCESS_AI_TRIGGER,
        {
          userId: 'u1',
          channelId: 'c1',
          conversationId: 'conv1',
          workspaceId: 'w1',
          tenantId: 't1',
          messageId: 'm1',
          botUserId: 'bot1',
        },
      );

      expect(result.id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      );
      // Asynchronous dispatch should not finish synchronously
      expect(executed).toBe(false);

      // Wait for next tick / setImmediate
      await new Promise((resolve) => setImmediate(resolve));
      expect(executed).toBe(true);
    });

    it('resolves AiOrchestrationProcessor via ModuleRef when no custom handler is registered', async () => {
      const mockProcessor = { process: jest.fn().mockResolvedValue(undefined) };
      moduleRef.get.mockReturnValue({
        [EQueueName.AI_ORCHESTRATION_QUEUE]: mockProcessor,
      });

      const result = await dispatcher.dispatch(
        EQueueName.AI_ORCHESTRATION_QUEUE,
        EJobName.PROCESS_AI_TRIGGER,
        {
          userId: 'u2',
          channelId: 'c2',
          conversationId: 'conv2',
          workspaceId: 'w2',
          tenantId: 't2',
          messageId: 'm2',
          botUserId: 'bot2',
        },
      );

      expect(result.id).toBeDefined();

      await new Promise((resolve) => setImmediate(resolve));
      expect(mockProcessor.process).toHaveBeenCalledWith(
        expect.objectContaining({
          id: result.id,
          name: EJobName.PROCESS_AI_TRIGGER,
          data: expect.objectContaining({ userId: 'u2' }),
        }),
      );
    });

    it('reports job counts with active count tracking', async () => {
      let finishJob: () => void;
      const jobPromise = new Promise<void>((resolve) => {
        finishJob = resolve;
      });

      dispatcher.registerHandler(
        EQueueName.AI_ORCHESTRATION_QUEUE,
        'long_job',
        async () => {
          await jobPromise;
        },
      );

      await dispatcher.dispatch(
        EQueueName.AI_ORCHESTRATION_QUEUE,
        'long_job' as any,
        {} as any,
      );

      const activeCounts = await dispatcher.getJobCounts(
        EQueueName.AI_ORCHESTRATION_QUEUE,
      );
      expect(activeCounts.active).toBe(1);

      finishJob!();
      await new Promise((resolve) => setImmediate(resolve));

      const settledCounts = await dispatcher.getJobCounts(
        EQueueName.AI_ORCHESTRATION_QUEUE,
      );
      expect(settledCounts.active).toBe(0);
    });
  });
});
