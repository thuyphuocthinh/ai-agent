import { Test, TestingModule } from '@nestjs/testing';
import { DatabaseHealthService } from './database-health.service';
import { PrismaService } from './prisma.service';

describe('DatabaseHealthService', () => {
  let service: DatabaseHealthService;
  const mockPrisma = {
    $queryRawUnsafe: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DatabaseHealthService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<DatabaseHealthService>(DatabaseHealthService);
  });

  it('returns true when query succeeds', async () => {
    mockPrisma.$queryRawUnsafe.mockResolvedValue([{ test: 1 }]);
    const result = await service.isAlive();
    expect(result).toBe(true);
    expect(mockPrisma.$queryRawUnsafe).toHaveBeenCalledWith('SELECT 1 as test');
  });

  it('returns false when query fails', async () => {
    mockPrisma.$queryRawUnsafe.mockRejectedValue(
      new Error('connection timeout'),
    );
    const result = await service.isAlive();
    expect(result).toBe(false);
  });
});
