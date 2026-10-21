import { Test, TestingModule } from '@nestjs/testing';
import { ORCHESTRATION_CONSTANTS } from '@agent/core/constants';
import { ConversationMemoryCleanupService } from './conversation-memory-cleanup.service';
import { ConversationMemoryService } from './conversation-memory.service';

describe('ConversationMemoryCleanupService', () => {
  let service: ConversationMemoryCleanupService;
  const mockMemoryService = { deleteExpired: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ConversationMemoryCleanupService,
        { provide: ConversationMemoryService, useValue: mockMemoryService },
      ],
    }).compile();

    service = module.get<ConversationMemoryCleanupService>(
      ConversationMemoryCleanupService,
    );
  });

  it('deletes expired memories using the configured TTL', async () => {
    mockMemoryService.deleteExpired.mockResolvedValue(0);

    await service.expireOldMemories();

    expect(mockMemoryService.deleteExpired).toHaveBeenCalledWith(
      ORCHESTRATION_CONSTANTS.CHANNEL_MEMORY_TTL_HOURS,
    );
  });

  it('does not throw when nothing was expired', async () => {
    mockMemoryService.deleteExpired.mockResolvedValue(0);

    await expect(service.expireOldMemories()).resolves.toBeUndefined();
  });

  it('completes normally after deleting expired rows', async () => {
    mockMemoryService.deleteExpired.mockResolvedValue(5);

    await expect(service.expireOldMemories()).resolves.toBeUndefined();
    expect(mockMemoryService.deleteExpired).toHaveBeenCalledTimes(1);
  });
});
