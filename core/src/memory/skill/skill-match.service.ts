import { Injectable, Optional } from '@nestjs/common';
import { CachedService } from '../../infrastructure/redis/cached.service';
import { CACHE } from '../../constants/cache.constant';
import { traceable } from 'langsmith/traceable';
import {
  CHARS_PER_TOKEN_ESTIMATE,
  OPENAI_EMBEDDING_MODEL,
  OpenAiEmbeddingProvider,
} from '../../infrastructure/embedding/openai-embedding.provider';
import {
  ISkillMatch,
  ISkillMatcher,
} from '../../contracts/skill/skill-matcher.interface';
import { attachEmbeddingCostMetadata } from '../../common/text/llm-cost.util';
import { cosineSimilarity } from '../../common/cosine-similarity.util';
import { readSkillAutoloadConfig } from '../../common/skill-autoload.config';
import { withTimeout } from '../../common/async/with-timeout.util';
import { DEFAULT_SKILL_TENANT_ID, SkillCatalogService } from './skill-catalog.service';
import { buildSkillEmbeddingText } from './skill-embedding-text.util';
import { SkillRecord } from './skill.interface';

interface CachedVector {
  updatedAtMs: number;
  vector: number[];
}

// Tự nạp skill theo độ khớp: so khớp prompt của lượt chạy với mô tả skill bằng
// embedding. Skill do admin soạn nên đáng tin ngay (khác cơ chế tự học đã gỡ),
// chỉ cần đủ liên quan. Vector skill được cache trong process theo
// (id, updatedAt) nên mỗi lượt thường chỉ tốn thêm 1 embedding cho prompt.
@Injectable()
export class SkillMatchService implements ISkillMatcher {
  private readonly vectorCache = new Map<string, CachedVector>();

  constructor(
    private readonly catalog: SkillCatalogService,
    private readonly embeddingProvider: OpenAiEmbeddingProvider,
    @Optional()
    private readonly cachedService?: CachedService,
  ) {}

  // Reject khi embedding lỗi/timeout — người gọi phải bắt và rơi về catalog.
  async match(
    prompt: string,
    tenantId = DEFAULT_SKILL_TENANT_ID,
  ): Promise<ISkillMatch[]> {
    const config = readSkillAutoloadConfig();
    const text = prompt.trim();
    if (!config.enabled || !text) return [];

    const candidates = (await this.catalog.listVisibleActive(tenantId)).filter(
      (skill) => skill.metadata?.autoLoad !== false,
    );
    if (candidates.length === 0) return [];

    const promptVector = await withTimeout(
      this.embedPromptAndMissingSkills(text, candidates),
      config.timeoutMs,
      `skill match timed out after ${config.timeoutMs}ms`,
    );

    return candidates
      .map((skill) => ({
        skill,
        score: cosineSimilarity(promptVector, this.vectorCache.get(skill.id)!.vector),
      }))
      .filter((m) => m.score >= config.minScore)
      .sort((a, b) => b.score - a.score)
      .slice(0, config.maxSkills);
  }

  // Một lần gọi embedding cho [prompt, ...skill chưa có vector hợp lệ]. Cache
  // được ghi ngay cả khi lần gọi này quá timeout, để lượt sau không phải tính lại.
  private async embedPromptAndMissingSkills(
    prompt: string,
    candidates: SkillRecord[],
  ): Promise<number[]> {
    const missingCandidates: SkillRecord[] = [];
    for (const skill of candidates) {
      const updatedAtMs = this.getSkillUpdatedAtMs(skill);
      const cached = this.vectorCache.get(skill.id);
      if (!cached || cached.updatedAtMs !== updatedAtMs) {
        missingCandidates.push(skill);
      }
    }

    const missing: SkillRecord[] = [];
    if (this.cachedService && missingCandidates.length > 0) {
      await Promise.all(
        missingCandidates.map(async (skill) => {
          const updatedAtMs = this.getSkillUpdatedAtMs(skill);
          const cacheKey = CACHE.SKILLS.KEYS.VECTOR(skill.id, updatedAtMs);
          const cachedVector = await this.cachedService!.get<number[]>(cacheKey);
          if (cachedVector && Array.isArray(cachedVector) && cachedVector.length > 0) {
            this.vectorCache.set(skill.id, {
              updatedAtMs,
              vector: cachedVector,
            });
          } else {
            missing.push(skill);
          }
        }),
      );
    } else {
      missing.push(...missingCandidates);
    }

    const texts = [prompt, ...missing.map(buildSkillEmbeddingText)];
    const estimatedTokens = Math.ceil(
      texts.reduce((sum, t) => sum + t.length, 0) / CHARS_PER_TOKEN_ESTIMATE,
    );

    const embed = traceable(
      async () => {
        const vectors = await this.embeddingProvider.embed(texts);
        attachEmbeddingCostMetadata(OPENAI_EMBEDDING_MODEL, estimatedTokens);
        return vectors;
      },
      { name: 'skill-match.embed', run_type: 'llm' },
    );
    const vectors = await embed();

    if (vectors.length !== texts.length) {
      throw new Error(
        `embedding trả ${vectors.length} vector cho ${texts.length} văn bản`,
      );
    }
    const [promptVector, ...skillVectors] = vectors;
    missing.forEach((skill, i) => {
      const vec = skillVectors[i];
      const updatedAtMs = this.getSkillUpdatedAtMs(skill);
      this.vectorCache.set(skill.id, {
        updatedAtMs,
        vector: vec,
      });
      if (this.cachedService) {
        const cacheKey = CACHE.SKILLS.KEYS.VECTOR(skill.id, updatedAtMs);
        this.cachedService
          .set(cacheKey, vec, CACHE.SKILLS.SETTINGS.VECTOR_TTL)
          .catch(() => {});
      }
    });
    return promptVector;
  }

  private getSkillUpdatedAtMs(skill: SkillRecord): number {
    if (skill.updatedAt instanceof Date) {
      return skill.updatedAt.getTime();
    }
    return new Date(skill.updatedAt).getTime();
  }
}
