import { Test, TestingModule } from '@nestjs/testing';
import { ECheckpointRiskLevel } from '@agent/core/constants';
import { SkillService } from './skill.service';
import { PrismaService } from '../infrastructure/database/prisma.service';

describe('SkillService', () => {
  let service: SkillService;

  const mockPrisma = {
    skill: {
      findMany: jest.fn(),
      create: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SkillService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<SkillService>(SkillService);
  });

  afterEach(() => jest.clearAllMocks());

  describe('findByWorkspace', () => {
    it('queries skills scoped to the given workspaceId', async () => {
      mockPrisma.skill.findMany.mockResolvedValue([
        {
          id: 'skill-1',
          tenantId: 'ws-1',
          taskDescription: 'test',
          summaryMarkdown: 'test',
          steps: [],
          sourceCheckpointIds: [],
          approvedRunCount: 1,
          riskLevel: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]);

      const result = await service.findByWorkspace('ws-1');

      expect(mockPrisma.skill.findMany).toHaveBeenCalledWith({
        where: { tenantId: 'ws-1' },
      });
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('skill-1');
      expect(result[0].workspaceId).toBe('ws-1');
    });
  });

  describe('create', () => {
    it('seeds sourceCheckpointIds with exactly the one checkpoint that produced this skill', async () => {
      mockPrisma.skill.create.mockResolvedValue({
        id: 'skill-1',
        tenantId: 'ws-1',
        taskDescription: 'tạo 5 sản phẩm ngẫu nhiên',
        summaryMarkdown: '## Tạo sản phẩm\nGọi execute_write_query để INSERT.',
        steps: [
          {
            provider: 'sql_server',
            tool: 'execute_write_query',
            argsTemplate: { query: 'INSERT INTO Products ...' },
          },
        ],
        sourceCheckpointIds: ['checkpoint-1'],
        approvedRunCount: 1,
        riskLevel: ECheckpointRiskLevel.MEDIUM,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      await service.create({
        workspaceId: 'ws-1',
        taskDescription: 'tạo 5 sản phẩm ngẫu nhiên',
        summaryMarkdown: '## Tạo sản phẩm\nGọi execute_write_query để INSERT.',
        steps: [
          {
            provider: 'sql_server',
            tool: 'execute_write_query',
            argsTemplate: { query: 'INSERT INTO Products ...' },
          },
        ],
        sourceCheckpointId: 'checkpoint-1',
        riskLevel: ECheckpointRiskLevel.MEDIUM,
      });

      expect(mockPrisma.skill.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ sourceCheckpointIds: ['checkpoint-1'] }),
      });
    });
  });

  describe('incrementApprovedRunCount', () => {
    it('bumps the count and appends the new checkpoint id, keeps steps unchanged', async () => {
      mockPrisma.skill.findUnique.mockResolvedValue({
        id: 'skill-1',
        approvedRunCount: 2,
        sourceCheckpointIds: ['checkpoint-1'],
      });
      mockPrisma.skill.update.mockResolvedValue({});

      await service.incrementApprovedRunCount('skill-1', 'checkpoint-2');

      expect(mockPrisma.skill.update).toHaveBeenCalledWith({
        where: { id: 'skill-1' },
        data: {
          approvedRunCount: 3,
          sourceCheckpointIds: ['checkpoint-1', 'checkpoint-2'],
        },
      });
    });

    it('does nothing when the skill no longer exists (deleted between match and record)', async () => {
      mockPrisma.skill.findUnique.mockResolvedValue(null);

      await service.incrementApprovedRunCount('skill-1', 'checkpoint-2');

      expect(mockPrisma.skill.update).not.toHaveBeenCalled();
    });
  });
});
