import { Injectable } from '@nestjs/common';
import { MessageRole, Prisma } from '@prisma/client';
import { EMessageRole, ORCHESTRATION_CONSTANTS } from '@agent/core/constants';
import { sanitizePrismaError } from '../../../common/errors';
import {
  extractKeywordSnippet,
  scoreHistoryMatch,
  splitSearchKeywords,
} from '../../../common/text/history-excerpt.util';
import {
  ConversationHistoryMatchDto,
  ConversationHistorySearchResult,
  IConversationHistorySearchRepository,
  SearchConversationHistoryParams,
} from '../../../contracts/memory/conversation-history-search.interface';
import { PrismaService } from '../prisma.service';
import { isEligibleHistoryMessage } from '../utils/prisma-history-filter.util';

const MESSAGE_SELECT = {
  id: true,
  role: true,
  text: true,
  createdAt: true,
} as const;

type SelectedMessageRow = Prisma.ConversationMessageGetPayload<{
  select: typeof MESSAGE_SELECT;
}>;

const FETCH_BUFFER = 5;
const FALLBACK_CANDIDATE_CAP = 80;

@Injectable()
export class PrismaConversationHistorySearchRepository
  implements IConversationHistorySearchRepository
{
  constructor(private readonly prisma: PrismaService) {}

  async search(
    params: SearchConversationHistoryParams,
  ): Promise<ConversationHistorySearchResult> {
    try {
      return params.aroundMessageId
        ? await this.searchAroundMessage(params)
        : await this.searchByFilters(params);
    } catch (error) {
      throw sanitizePrismaError(
        error,
        'PrismaConversationHistorySearchRepository.search',
      );
    }
  }

  private async searchByFilters(
    params: SearchConversationHistoryParams,
  ): Promise<ConversationHistorySearchResult> {
    const keywords = splitSearchKeywords(params.query);
    const strictWhere = this.buildFilterWhere(params, keywords, 'AND');

    const [strictTotal, strictRows] = await Promise.all([
      this.prisma.conversationMessage.count({ where: strictWhere }),
      this.prisma.conversationMessage.findMany({
        where: strictWhere,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: params.offset,
        take: params.limit + FETCH_BUFFER,
        select: MESSAGE_SELECT,
      }),
    ]);

    const strictEligible = this.filterEligible(strictRows);
    if (keywords.length <= 1 || strictEligible.length >= params.limit || strictTotal > 0) {
      return {
        mode: 'search',
        totalMatches: strictTotal,
        items: strictEligible
          .slice(0, params.limit)
          .map((r) =>
            this.toMatchDto(
              r,
              keywords,
              ORCHESTRATION_CONSTANTS.HISTORY_SEARCH_SNIPPET_CHARS,
            ),
          ),
      };
    }

    return this.searchRankedOrFallback(params, keywords);
  }

  private async searchRankedOrFallback(
    params: SearchConversationHistoryParams,
    keywords: readonly string[],
  ): Promise<ConversationHistorySearchResult> {
    const orWhere = this.buildFilterWhere(params, keywords, 'OR');
    const candidates = await this.prisma.conversationMessage.findMany({
      where: orWhere,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: FALLBACK_CANDIDATE_CAP,
      select: MESSAGE_SELECT,
    });

    const minMatches = keywords.length >= 4 ? 2 : 1;
    const scored = this.filterEligible(candidates)
      .map((row) => ({
        row,
        ...scoreHistoryMatch(row.text, params.query, keywords),
      }))
      .filter((entry) => entry.matchedCount >= minMatches)
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return b.row.createdAt.getTime() - a.row.createdAt.getTime();
      });

    const items = scored
      .slice(params.offset, params.offset + params.limit)
      .map((entry) =>
        this.toMatchDto(
          entry.row,
          keywords,
          ORCHESTRATION_CONSTANTS.HISTORY_SEARCH_SNIPPET_CHARS,
        ),
      );

    return {
      mode: 'search',
      totalMatches: scored.length,
      items,
    };
  }

  private async searchAroundMessage(
    params: SearchConversationHistoryParams,
  ): Promise<ConversationHistorySearchResult> {
    const target = await this.prisma.conversationMessage.findFirst({
      where: {
        id: params.aroundMessageId,
        conversationId: params.conversationId,
        isText: true,
      },
      select: MESSAGE_SELECT,
    });
    if (!target || !isEligibleHistoryMessage(target.text)) {
      return { mode: 'around', totalMatches: 0, items: [] };
    }

    const window =
      params.contextWindow ??
      ORCHESTRATION_CONSTANTS.HISTORY_SEARCH_CONTEXT_WINDOW_DEFAULT;
    const takeEachSide = window + FETCH_BUFFER;

    const [beforeDesc, afterAsc] = await Promise.all([
      this.fetchAdjacent(params.conversationId, target.createdAt, 'desc', takeEachSide),
      this.fetchAdjacent(params.conversationId, target.createdAt, 'asc', takeEachSide),
    ]);

    const ordered = this.mergeChronologically([
      ...beforeDesc.reverse(),
      target,
      ...afterAsc,
    ]);
    const centerIdx = ordered.findIndex((r) => r.id === target.id);
    if (centerIdx === -1) {
      return { mode: 'around', totalMatches: 0, items: [] };
    }

    const slice = ordered.slice(
      Math.max(0, centerIdx - window),
      centerIdx + window + 1,
    );
    const items = slice.map((r) =>
      this.toMatchDto(
        r,
        [],
        ORCHESTRATION_CONSTANTS.CONTEXT_EDIT_AI_TEXT_MAX_CHARS,
      ),
    );
    return { mode: 'around', totalMatches: items.length, items };
  }

  private buildFilterWhere(
    params: SearchConversationHistoryParams,
    keywords: readonly string[],
    combinator: 'AND' | 'OR',
  ): Prisma.ConversationMessageWhereInput {
    const hasDateRange = Boolean(params.fromDate || params.toDate);
    const keywordClauses = keywords.map((kw) => ({
      text: { contains: kw, mode: 'insensitive' as const },
    }));

    return {
      conversationId: params.conversationId,
      isText: true,
      ...(params.role
        ? {
            role:
              params.role === EMessageRole.USER
                ? MessageRole.USER
                : MessageRole.ASSISTANT,
          }
        : {}),
      ...(hasDateRange
        ? {
            createdAt: {
              ...(params.fromDate ? { gte: params.fromDate } : {}),
              ...(params.toDate ? { lte: params.toDate } : {}),
            },
          }
        : {}),
      ...(keywordClauses.length > 0 ? { [combinator]: keywordClauses } : {}),
    };
  }

  private fetchAdjacent(
    conversationId: string,
    anchor: Date,
    direction: 'asc' | 'desc',
    take: number,
  ): Promise<SelectedMessageRow[]> {
    return this.prisma.conversationMessage.findMany({
      where: {
        conversationId,
        isText: true,
        createdAt: direction === 'desc' ? { lte: anchor } : { gte: anchor },
      },
      orderBy: [{ createdAt: direction }, { id: direction }],
      take,
      select: MESSAGE_SELECT,
    });
  }

  private filterEligible(rows: readonly SelectedMessageRow[]): SelectedMessageRow[] {
    return rows.filter((r) => Boolean(r.text.trim()) && isEligibleHistoryMessage(r.text));
  }

  private mergeChronologically(
    rows: readonly SelectedMessageRow[],
  ): SelectedMessageRow[] {
    const byId = new Map<string, SelectedMessageRow>();
    for (const r of this.filterEligible(rows)) {
      byId.set(r.id, r);
    }
    return Array.from(byId.values()).sort((a, b) => {
      const diff = a.createdAt.getTime() - b.createdAt.getTime();
      return diff !== 0 ? diff : a.id.localeCompare(b.id);
    });
  }

  private toMatchDto(
    row: SelectedMessageRow,
    keywords: readonly string[],
    maxChars: number,
  ): ConversationHistoryMatchDto {
    const snippet = extractKeywordSnippet(row.text, keywords, maxChars);
    return {
      messageId: row.id,
      role: row.role === MessageRole.USER ? EMessageRole.USER : EMessageRole.MODEL,
      createdAt: row.createdAt.toISOString(),
      text: snippet.text,
      truncated: snippet.truncated,
    };
  }
}
