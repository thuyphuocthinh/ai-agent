import { SkillMatchService } from './skill-match.service';
import { SkillCatalogService } from './skill-catalog.service';
import { OpenAiEmbeddingProvider } from '../../infrastructure/embedding/openai-embedding.provider';
import { SkillRecord } from './skill.interface';

const ENV_KEYS = [
  'SKILL_AUTOLOAD_ENABLED',
  'SKILL_AUTOLOAD_MIN_SCORE',
  'SKILL_AUTOLOAD_MAX_SKILLS',
  'SKILL_AUTOLOAD_MAX_CHARS',
  'SKILL_AUTOLOAD_TIMEOUT_MS',
] as const;

function buildSkill(overrides: Partial<SkillRecord> = {}): SkillRecord {
  return {
    id: 'skill-1',
    tenantId: 'default',
    slug: 'sql-safe-write',
    name: 'Ghi SQL an toàn',
    description: 'Quy tắc khi sửa/xóa dữ liệu trong cơ sở dữ liệu',
    instructions: '# Hướng dẫn',
    tools: [],
    tags: ['sql'],
    isActive: true,
    metadata: {},
    createdAt: new Date('2026-10-29T00:00:00Z'),
    updatedAt: new Date('2026-10-29T00:00:00Z'),
    ...overrides,
  };
}

describe('SkillMatchService', () => {
  const mockCatalog = { listVisibleActive: jest.fn() };
  const mockEmbedding = { embed: jest.fn() };
  const savedEnv: Record<string, string | undefined> = {};
  let service: SkillMatchService;

  // Vector 2 chiều: prompt ở trục [1, 0]; mỗi skill có điểm cosine định sẵn.
  const vectorWithScore = (score: number): number[] => [
    score,
    Math.sqrt(1 - score * score),
  ];
  const PROMPT_VECTOR = [1, 0];

  // Trả vector cho từng văn bản theo bảng điểm (văn bản đầu tiên là prompt).
  const embedWith = (scoreByTextPart: Record<string, number>) =>
    mockEmbedding.embed.mockImplementation(async (texts: string[]) =>
      texts.map((text, i) => {
        if (i === 0) return PROMPT_VECTOR;
        const key = Object.keys(scoreByTextPart).find((k) => text.includes(k));
        return vectorWithScore(key ? scoreByTextPart[key] : 0);
      }),
    );

  beforeEach(() => {
    for (const key of ENV_KEYS) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
    service = new SkillMatchService(
      mockCatalog as unknown as SkillCatalogService,
      mockEmbedding as unknown as OpenAiEmbeddingProvider,
    );
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    }
    jest.resetAllMocks();
  });

  describe('matching (AC-8)', () => {
    it('returns the skills at or above the min score, best first, with their score', async () => {
      mockCatalog.listVisibleActive.mockResolvedValue([
        buildSkill({ id: 'a', slug: 'a', name: 'Alpha' }),
        buildSkill({ id: 'b', slug: 'b', name: 'Bravo' }),
        buildSkill({ id: 'c', slug: 'c', name: 'Charlie' }),
      ]);
      embedWith({ Alpha: 0.5, Bravo: 0.8, Charlie: 0.1 });

      const result = await service.match('đổi tên sản phẩm', 'tenant-a');

      expect(result.map((m) => m.skill.slug)).toEqual(['b', 'a']);
      expect(result[0].score).toBeCloseTo(0.8, 5);
      expect(result[1].score).toBeCloseTo(0.5, 5);
    });

    it('keeps a skill whose score is at the min score', async () => {
      process.env.SKILL_AUTOLOAD_MIN_SCORE = '0.5';
      mockCatalog.listVisibleActive.mockResolvedValue([buildSkill({ name: 'Alpha' })]);
      embedWith({ Alpha: 0.5001 });

      const result = await service.match('x');

      expect(result).toHaveLength(1);
    });

    it('returns nothing when no skill reaches the threshold', async () => {
      mockCatalog.listVisibleActive.mockResolvedValue([buildSkill({ name: 'Alpha' })]);
      embedWith({ Alpha: 0.2 });

      await expect(service.match('2 cộng 2 bằng mấy?')).resolves.toEqual([]);
    });

    it('limits the result to SKILL_AUTOLOAD_MAX_SKILLS', async () => {
      process.env.SKILL_AUTOLOAD_MAX_SKILLS = '1';
      mockCatalog.listVisibleActive.mockResolvedValue([
        buildSkill({ id: 'a', slug: 'a', name: 'Alpha' }),
        buildSkill({ id: 'b', slug: 'b', name: 'Bravo' }),
      ]);
      embedWith({ Alpha: 0.6, Bravo: 0.9 });

      const result = await service.match('x');

      expect(result.map((m) => m.skill.slug)).toEqual(['b']);
    });

    it('never returns a skill with metadata.autoLoad === false', async () => {
      mockCatalog.listVisibleActive.mockResolvedValue([
        buildSkill({ id: 'a', slug: 'a', name: 'Alpha', metadata: { autoLoad: false } }),
        buildSkill({ id: 'b', slug: 'b', name: 'Bravo', metadata: { autoLoad: true } }),
        buildSkill({ id: 'c', slug: 'c', name: 'Charlie' }),
      ]);
      embedWith({ Alpha: 0.9, Bravo: 0.7, Charlie: 0.6 });

      const result = await service.match('x');

      expect(result.map((m) => m.skill.slug)).toEqual(['b', 'c']);
      const texts = mockEmbedding.embed.mock.calls[0][0] as string[];
      expect(texts.join('|')).not.toContain('Alpha');
    });

    it('asks the catalog for the skills visible to the given tenant', async () => {
      mockCatalog.listVisibleActive.mockResolvedValue([]);

      await service.match('x', 'tenant-a');

      expect(mockCatalog.listVisibleActive).toHaveBeenCalledWith('tenant-a');
    });

    it('defaults to the shared tenant', async () => {
      mockCatalog.listVisibleActive.mockResolvedValue([]);

      await service.match('x');

      expect(mockCatalog.listVisibleActive).toHaveBeenCalledWith('default');
    });

    it('embeds name, description and tags but not the instructions of the skill', async () => {
      mockCatalog.listVisibleActive.mockResolvedValue([
        buildSkill({ instructions: 'NỘI DUNG HƯỚNG DẪN RIÊNG' }),
      ]);
      embedWith({});

      await service.match('đổi tên sản phẩm');

      const texts = mockEmbedding.embed.mock.calls[0][0] as string[];
      expect(texts[0]).toBe('đổi tên sản phẩm');
      expect(texts[1]).toContain('Ghi SQL an toàn');
      expect(texts[1]).toContain('Quy tắc khi sửa/xóa dữ liệu');
      expect(texts[1]).toContain('sql');
      expect(texts[1]).not.toContain('NỘI DUNG HƯỚNG DẪN RIÊNG');
    });
  });

  describe('embedding cost control (AC-9)', () => {
    it('makes a single embedding call for the prompt and all uncached skills', async () => {
      mockCatalog.listVisibleActive.mockResolvedValue([
        buildSkill({ id: 'a', name: 'Alpha' }),
        buildSkill({ id: 'b', name: 'Bravo' }),
      ]);
      embedWith({});

      await service.match('x');

      expect(mockEmbedding.embed).toHaveBeenCalledTimes(1);
      expect(mockEmbedding.embed.mock.calls[0][0]).toHaveLength(3);
    });

    it('embeds only the prompt once every skill vector is cached', async () => {
      mockCatalog.listVisibleActive.mockResolvedValue([
        buildSkill({ id: 'a', name: 'Alpha' }),
      ]);
      embedWith({ Alpha: 0.7 });

      await service.match('lần 1');
      const second = await service.match('lần 2');

      expect(mockEmbedding.embed).toHaveBeenCalledTimes(2);
      expect(mockEmbedding.embed.mock.calls[1][0]).toEqual(['lần 2']);
      expect(second).toHaveLength(1);
    });

    it('re-embeds only the skill whose updatedAt changed', async () => {
      const a = buildSkill({ id: 'a', name: 'Alpha' });
      const b = buildSkill({ id: 'b', name: 'Bravo' });
      mockCatalog.listVisibleActive.mockResolvedValue([a, b]);
      embedWith({ Alpha: 0.7, Bravo: 0.7 });
      await service.match('lần 1');

      mockCatalog.listVisibleActive.mockResolvedValue([
        a,
        { ...b, name: 'Bravo mới', updatedAt: new Date('2026-10-30T00:00:00Z') },
      ]);
      await service.match('lần 2');

      const texts = mockEmbedding.embed.mock.calls[1][0] as string[];
      expect(texts).toHaveLength(2);
      expect(texts[1]).toContain('Bravo mới');
    });

    it.each(['', '   \n '])(
      'does not call the catalog or the embedding API for the empty prompt %j',
      async (prompt) => {
        await expect(service.match(prompt)).resolves.toEqual([]);

        expect(mockCatalog.listVisibleActive).not.toHaveBeenCalled();
        expect(mockEmbedding.embed).not.toHaveBeenCalled();
      },
    );

    it('does not call the embedding API when the tenant has no eligible skill', async () => {
      mockCatalog.listVisibleActive.mockResolvedValue([
        buildSkill({ metadata: { autoLoad: false } }),
      ]);

      await expect(service.match('x')).resolves.toEqual([]);
      expect(mockEmbedding.embed).not.toHaveBeenCalled();
    });
  });

  describe('controls (AC-13)', () => {
    it.each(['false', '0'])(
      'does nothing (no catalog query, no embedding) when SKILL_AUTOLOAD_ENABLED=%s',
      async (value) => {
        process.env.SKILL_AUTOLOAD_ENABLED = value;

        await expect(service.match('đổi tên sản phẩm')).resolves.toEqual([]);

        expect(mockCatalog.listVisibleActive).not.toHaveBeenCalled();
        expect(mockEmbedding.embed).not.toHaveBeenCalled();
      },
    );

    it('uses the min score from the environment', async () => {
      process.env.SKILL_AUTOLOAD_MIN_SCORE = '0.9';
      mockCatalog.listVisibleActive.mockResolvedValue([buildSkill({ name: 'Alpha' })]);
      embedWith({ Alpha: 0.8 });

      await expect(service.match('x')).resolves.toEqual([]);
    });
  });

  describe('failures (AC-12)', () => {
    it('rejects when the embedding call fails so the caller can fall back to the catalog', async () => {
      mockCatalog.listVisibleActive.mockResolvedValue([buildSkill()]);
      mockEmbedding.embed.mockRejectedValue(new Error('no api key'));

      await expect(service.match('x')).rejects.toThrow('no api key');
    });

    it('rejects when the embedding call exceeds SKILL_AUTOLOAD_TIMEOUT_MS', async () => {
      process.env.SKILL_AUTOLOAD_TIMEOUT_MS = '20';
      mockCatalog.listVisibleActive.mockResolvedValue([buildSkill()]);
      mockEmbedding.embed.mockImplementation(() => new Promise(() => undefined));

      await expect(service.match('x')).rejects.toThrow('timed out after 20ms');
    });

    it('rejects when the provider returns the wrong number of vectors', async () => {
      mockCatalog.listVisibleActive.mockResolvedValue([buildSkill()]);
      mockEmbedding.embed.mockResolvedValue([PROMPT_VECTOR]);

      await expect(service.match('x')).rejects.toThrow('vector');
    });

    it('does not cache anything when the embedding call failed', async () => {
      mockCatalog.listVisibleActive.mockResolvedValue([buildSkill({ name: 'Alpha' })]);
      mockEmbedding.embed.mockRejectedValueOnce(new Error('boom'));
      await expect(service.match('x')).rejects.toThrow('boom');

      embedWith({ Alpha: 0.7 });
      await service.match('y');

      expect(mockEmbedding.embed.mock.calls[1][0]).toHaveLength(2);
    });
  });
});
