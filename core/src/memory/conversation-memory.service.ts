import { Injectable, Logger } from '@nestjs/common';
import { traceable } from 'langsmith/traceable';
import { buildTTL } from '@agent/core/common';
import { ORCHESTRATION_CONSTANTS } from '@agent/core/constants';
import { SemanticToolIndex } from '../common/agentic-openapi-parser';
import {
  OPENAI_EMBEDDING_MODEL,
  OpenAiEmbeddingProvider,
  CHARS_PER_TOKEN_ESTIMATE,
} from './embedding/openai-embedding.provider';
import { PrismaService } from '../infrastructure/database/prisma.service';
import { ConversationMemoryEntity } from '../infrastructure/database/entities/conversation-memory.entity';
import { ToolCallTraceDto } from '../contracts/dtos/react-loop.dto';
import { isLikelyCreateToolCall } from './create-tool-heuristic.util';
import { looksLikeInjection } from './memory-injection-heuristic.util';
import { attachEmbeddingCostMetadata } from '../engine/loop/llm-cost.util';
import { cosineSimilarity } from './skill-cosine-similarity.util';

const FACT_SUPERSEDE_SIMILARITY_THRESHOLD = 0.85;

// SemanticToolIndex chỉ cần {name, description} — dùng row.id làm khoá join
// ngược lại entity gốc sau khi search() trả về, row.content làm text để embed.
interface IndexableMemory {
  name: string;
  description: string;
}

// Ghi nhớ THỰC THỂ ổn định vừa được tạo thành công trong 1 cuộc hội thoại,
// đọc lại làm gợi ý ngữ cảnh cho SupervisorService.plan().
@Injectable()
export class ConversationMemoryService {
  private readonly logger = new Logger(ConversationMemoryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly embeddingProvider: OpenAiEmbeddingProvider,
  ) {}

  async recordSuccessfulCreateCalls(
    channelId: string,
    sourceMessageId: string,
    toolCalls: ToolCallTraceDto[],
  ): Promise<void> {
    const maxChars = ORCHESTRATION_CONSTANTS.CHANNEL_MEMORY_CONTENT_MAX_CHARS;
    const rows = toolCalls
      .filter(
        (tc) =>
          tc.status === 'success' &&
          Boolean(tc.resultPreview) &&
          isLikelyCreateToolCall(tc),
      )
      .map((tc) => {
        const joined = `${tc.tool}: ${tc.resultPreview ?? ''}`;
        return {
          conversationId: channelId,
          sourceMessageId,
          tool: tc.tool,
          content:
            joined.length > maxChars
              ? `${joined.slice(0, maxChars)}...`
              : joined,
        };
      })
      .filter((row) => {
        if (!looksLikeInjection(row.content)) return true;
        this.logger.warn(
          `recordSuccessfulCreateCalls() skipped a suspicious memory for channel ${channelId} (looks like a prompt injection attempt)`,
        );
        return false;
      });

    if (rows.length === 0) return;

    try {
      await this.prisma.conversationMemory.createMany({
        data: rows,
        skipDuplicates: true,
      });
    } catch (error) {
      this.logger.warn(
        `recordSuccessfulCreateCalls() failed for channel ${channelId}: ${(error as Error).message}`,
      );
    }
  }

  async recordUserDeclaredFact(
    channelId: string,
    sourceMessageId: string,
    fact: string,
  ): Promise<void> {
    const maxChars = ORCHESTRATION_CONSTANTS.CHANNEL_MEMORY_CONTENT_MAX_CHARS;
    const content =
      fact.length > maxChars ? `${fact.slice(0, maxChars)}...` : fact;

    if (looksLikeInjection(content)) {
      this.logger.warn(
        `recordUserDeclaredFact() skipped a suspicious memory for channel ${channelId} (looks like a prompt injection attempt)`,
      );
      return;
    }

    const supersededId = await this.findSupersededFactId(channelId, content);

    try {
      if (supersededId) {
        await this.prisma.conversationMemory.delete({
          where: { id: supersededId },
        });
      }
      await this.prisma.conversationMemory.create({
        data: {
          conversationId: channelId,
          sourceMessageId,
          tool: 'user_declared_fact',
          content,
        },
      });
    } catch (error) {
      this.logger.warn(
        `recordUserDeclaredFact() failed for channel ${channelId}: ${(error as Error).message}`,
      );
    }
  }

  private async findSupersededFactId(
    channelId: string,
    content: string,
  ): Promise<string | null> {
    try {
      const existing = await this.prisma.conversationMemory.findMany({
        where: { conversationId: channelId, tool: 'user_declared_fact' },
      });
      if (existing.length === 0) return null;

      const estimatedChars =
        content.length +
        existing.reduce((sum, row) => sum + row.content.length, 0);
      const estimatedTokens = Math.ceil(
        estimatedChars / CHARS_PER_TOKEN_ESTIMATE,
      );

      const embed = traceable(
        async () => {
          const vectors = await this.embeddingProvider.embed([
            content,
            ...existing.map((row) => row.content),
          ]);
          attachEmbeddingCostMetadata(OPENAI_EMBEDDING_MODEL, estimatedTokens);
          return vectors;
        },
        { name: 'conversation-memory.findSupersededFactId', run_type: 'llm' },
      );
      const [queryVector, ...candidateVectors] = await embed();

      let bestId: string | null = null;
      let bestScore = FACT_SUPERSEDE_SIMILARITY_THRESHOLD;
      for (let i = 0; i < existing.length; i++) {
        const score = cosineSimilarity(queryVector, candidateVectors[i]);
        if (score >= bestScore) {
          bestId = existing[i].id;
          bestScore = score;
        }
      }
      return bestId;
    } catch (error) {
      this.logger.warn(
        `findSupersededFactId() failed for channel ${channelId}: ${(error as Error).message}`,
      );
      return null;
    }
  }

  // Dọn fact đã quá TTL, gọi định kỳ từ ChannelMemoryCleanupService. TTL cố
  // định cho mọi row nên chỉ cần so createdAt với ngưỡng thời gian, không cần
  // cột expiresAt riêng.
  async deleteExpired(ttlHours: number): Promise<number> {
    const cutoff = new Date(Date.now() - buildTTL('HOUR', ttlHours));
    const result = await this.prisma.conversationMemory.deleteMany({
      where: { createdAt: { lt: cutoff } },
    });
    return result.count;
  }

  // queryText (thường là prompt hiện tại) xếp hạng theo ngữ nghĩa thay vì chỉ
  // recency — bỏ qua hoặc embedding lỗi thì rơi về đúng thứ tự cũ.
  async getRecentMemories(
    channelId: string,
    charBudget: number = ORCHESTRATION_CONSTANTS.CHANNEL_MEMORY_READ_LIMIT *
      ORCHESTRATION_CONSTANTS.CHANNEL_MEMORY_CONTENT_MAX_CHARS,
    queryText?: string,
  ): Promise<ConversationMemoryEntity[]> {
    try {
      const rows = await this.prisma.conversationMemory.findMany({
        where: { conversationId: channelId },
        orderBy: { createdAt: 'desc' },
        take: ORCHESTRATION_CONSTANTS.CHANNEL_MEMORY_READ_LIMIT,
      });
      const entities: ConversationMemoryEntity[] = rows.map((r) => {
        const entity = new ConversationMemoryEntity();
        entity.id = r.id;
        entity.conversationId = r.conversationId;
        entity.sourceMessageId = r.sourceMessageId;
        entity.tool = r.tool;
        entity.content = r.content;
        entity.createdAt = r.createdAt;
        return entity;
      });
      const ranked = queryText
        ? await this.rankBySimilarity(entities, queryText)
        : entities;
      return this.capToCharBudget(ranked, charBudget);
    } catch (error) {
      this.logger.warn(
        `getRecentMemories() failed for channel ${channelId}: ${(error as Error).message}`,
      );
      return [];
    }
  }

  private async rankBySimilarity(
    rows: ConversationMemoryEntity[],
    queryText: string,
  ): Promise<ConversationMemoryEntity[]> {
    if (rows.length === 0) return rows;

    const estimatedChars =
      rows.reduce((sum, row) => sum + (row.content?.length ?? 0), 0) +
      queryText.length;
    const estimatedTokens = Math.ceil(
      estimatedChars / CHARS_PER_TOKEN_ESTIMATE,
    );

    const rank = traceable(
      async () => {
        const index = new SemanticToolIndex<IndexableMemory>(
          this.embeddingProvider,
        );
        await index.build(
          rows.map((row) => ({ name: row.id, description: row.content })),
        );
        const searched = await index.search(queryText, rows.length);
        attachEmbeddingCostMetadata(OPENAI_EMBEDDING_MODEL, estimatedTokens);
        return searched;
      },
      { name: 'conversation-memory.rankBySimilarity', run_type: 'llm' },
    );

    try {
      const ranked = await rank();
      const byId = new Map(rows.map((row) => [row.id, row]));
      const result = ranked
        .map((item) => byId.get(item.name))
        .filter((row): row is ConversationMemoryEntity => Boolean(row));
      return result.length > 0 ? result : rows;
    } catch (error) {
      this.logger.warn(
        `rankBySimilarity() failed, falling back to recency order: ${(error as Error).message}`,
      );
      return rows;
    }
  }

  private capToCharBudget(
    rows: ConversationMemoryEntity[],
    charBudget: number,
  ): ConversationMemoryEntity[] {
    const kept: ConversationMemoryEntity[] = [];
    let used = 0;
    for (const row of rows) {
      const next = used + (row.content?.length ?? 0);
      if (next > charBudget && kept.length > 0) break;
      kept.push(row);
      used = next;
    }
    return kept;
  }
}

// Backward compatibility alias
export { ConversationMemoryService as ChannelMemoryService };
