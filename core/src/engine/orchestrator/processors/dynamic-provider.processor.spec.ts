import { Test, TestingModule } from '@nestjs/testing';
import { DynamicProviderProcessor } from './dynamic-provider.processor';
import { PrismaService } from '../../../infrastructure/database/prisma.service';
import { EJobName } from '@agent/core/infrastructure/queue';
import { Job } from 'bullmq';
import { Logger } from '@nestjs/common';

describe('DynamicProviderProcessor', () => {
  let processor: DynamicProviderProcessor;
  let mockPrisma: {
    dynamicProvider: {
      update: jest.Mock;
      updateMany: jest.Mock;
    };
  };

  beforeEach(async () => {
    mockPrisma = {
      dynamicProvider: {
        update: jest.fn(),
        updateMany: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DynamicProviderProcessor,
        {
          provide: PrismaService,
          useValue: mockPrisma,
        },
      ],
    }).compile();

    processor = module.get<DynamicProviderProcessor>(DynamicProviderProcessor);
    // Mock logger to keep test output clean
    processor.logger = {
      log: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
      verbose: jest.fn(),
    } as unknown as Logger;
  });

  it('should be defined', () => {
    expect(processor).toBeDefined();
  });

  describe('process', () => {
    it('should handle UPDATE_DYNAMIC_PROVIDER_TOKEN job successfully without previousRefreshToken (legacy job)', async () => {
      const jobData = {
        providerId: 'test-provider-id',
        accessToken: 'new-access-token',
        refreshToken: 'new-refresh-token',
        tokenExpiresAt: new Date('2030-01-01T00:00:00.000Z'),
      };

      const job = {
        name: EJobName.UPDATE_DYNAMIC_PROVIDER_TOKEN,
        data: jobData,
      } as Job;

      mockPrisma.dynamicProvider.update.mockResolvedValue({});

      await expect(processor.process(job)).resolves.not.toThrow();

      expect(mockPrisma.dynamicProvider.update).toHaveBeenCalledWith({
        where: { id: 'test-provider-id' },
        data: {
          accessToken: 'new-access-token',
          refreshToken: 'new-refresh-token',
          tokenExpiresAt: jobData.tokenExpiresAt,
        },
      });
      expect(processor.logger.log).toHaveBeenCalledWith(
        'Successfully persisted token for provider test-provider-id via Queue.',
      );
    });

    it('should scope the update to previousRefreshToken when present (CAS)', async () => {
      const jobData = {
        providerId: 'test-provider-id',
        accessToken: 'new-access-token',
        refreshToken: 'new-refresh-token',
        tokenExpiresAt: new Date('2030-01-01T00:00:00.000Z'),
        previousRefreshToken: 'old-refresh-token',
      };

      const job = {
        name: EJobName.UPDATE_DYNAMIC_PROVIDER_TOKEN,
        data: jobData,
      } as Job;

      mockPrisma.dynamicProvider.updateMany.mockResolvedValue({ count: 1 });

      await processor.process(job);

      expect(mockPrisma.dynamicProvider.updateMany).toHaveBeenCalledWith({
        where: { id: 'test-provider-id', refreshToken: 'old-refresh-token' },
        data: {
          accessToken: 'new-access-token',
          refreshToken: 'new-refresh-token',
          tokenExpiresAt: jobData.tokenExpiresAt,
        },
      });
    });

    it('should skip (not throw) when previousRefreshToken no longer matches — token already rotated by a newer job', async () => {
      const jobData = {
        providerId: 'test-provider-id',
        accessToken: 'stale-access-token',
        refreshToken: 'stale-refresh-token',
        previousRefreshToken: 'old-refresh-token',
      };

      const job = {
        name: EJobName.UPDATE_DYNAMIC_PROVIDER_TOKEN,
        data: jobData,
      } as Job;

      mockPrisma.dynamicProvider.updateMany.mockResolvedValue({ count: 0 });

      await expect(processor.process(job)).resolves.not.toThrow();

      expect(processor.logger.warn).toHaveBeenCalledWith(
        'Skipped stale token write for provider test-provider-id — refreshToken already rotated by a newer update.',
      );
      expect(processor.logger.log).not.toHaveBeenCalled();
    });

    it('should throw an error if update fails, so BullMQ can retry', async () => {
      const jobData = {
        providerId: 'test-provider-id',
        accessToken: 'new-access-token',
      };

      const job = {
        name: EJobName.UPDATE_DYNAMIC_PROVIDER_TOKEN,
        data: jobData,
      } as Job;

      const dbError = new Error('Database connection failed');
      mockPrisma.dynamicProvider.update.mockRejectedValue(dbError);

      await expect(processor.process(job)).rejects.toThrow(
        'Database connection failed',
      );

      expect(mockPrisma.dynamicProvider.update).toHaveBeenCalledWith({
        where: { id: 'test-provider-id' },
        data: {
          accessToken: 'new-access-token',
          refreshToken: undefined,
          tokenExpiresAt: undefined,
        },
      });
      expect(processor.logger.error).toHaveBeenCalledWith(
        'Failed to persist token for provider test-provider-id via Queue: Database connection failed',
        expect.any(String),
      );
    });

    it('should log a warning if job name is unknown', async () => {
      const job = {
        name: 'UNKNOWN_JOB_NAME' as any,
        data: {},
      } as Job;

      await processor.process(job);

      expect(processor.logger.warn).toHaveBeenCalledWith(
        'Unknown job name: UNKNOWN_JOB_NAME',
      );
      expect(mockPrisma.dynamicProvider.update).not.toHaveBeenCalled();
    });
  });
});
