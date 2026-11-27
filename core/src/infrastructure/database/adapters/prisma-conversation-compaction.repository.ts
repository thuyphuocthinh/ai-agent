import { Injectable } from '@nestjs/common';
import { EMessageRole } from '@agent/core/constants';
import { MessageRole, Prisma } from '@prisma/client';
import { asJsonObject } from '../../../common/text/structured-payload.util';
import {
  CompactionMessageRecord,
  ConversationCompactionState,
  IConversationCompactionRepository,
} from '../../../contracts/memory/conversation-compaction.interface';
import { PrismaService } from '../prisma.service';
import { isEligibleHistoryMessage } from '../utils/prisma-history-filter.util';

@Injectable()
export class PrismaConversationCompactionRepository
  implements IConversationCompactionRepository
{
  constructor(private readonly prisma: PrismaService) {}

  async getCompactionState(
    conversationId: string,
  ): Promise<ConversationCompactionState | null> {
    const row = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      select: { metadata: true },
    });
    const compaction = asJsonObject(asJsonObject(row?.metadata)?.compaction);
    if (
      !compaction ||
      typeof compaction.summary !== 'string' ||
      typeof compaction.summarizedUntilMessageId !== 'string' ||
      typeof compaction.updatedAt !== 'string'
    ) {
      return null;
    }
    return {
      summary: compaction.summary,
      summarizedUntilMessageId: compaction.summarizedUntilMessageId,
      updatedAt: compaction.updatedAt,
    };
  }

  async saveCompactionState(
    conversationId: string,
    state: ConversationCompactionState,
  ): Promise<void> {
    const row = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      select: { metadata: true },
    });
    const existing = asJsonObject(row?.metadata) ?? {};
    const updatedMetadata: Prisma.InputJsonObject = {
      ...(existing as Prisma.JsonObject),
      compaction: {
        summary: state.summary,
        summarizedUntilMessageId: state.summarizedUntilMessageId,
        updatedAt: state.updatedAt,
      },
    };
    await this.prisma.conversation.update({
      where: { id: conversationId },
      data: { metadata: updatedMetadata },
    });
  }

  async getMessagesInWindow(params: {
    conversationId: string;
    afterMessageId?: string;
    beforeMessageId?: string;
    limit: number;
  }): Promise<CompactionMessageRecord[]> {
    const afterAt = params.afterMessageId
      ? await this.resolveCreatedAt(params.afterMessageId)
      : undefined;
    const beforeAt = params.beforeMessageId
      ? await this.resolveCreatedAt(params.beforeMessageId)
      : undefined;

    const rows = await this.prisma.conversationMessage.findMany({
      where: {
        conversationId: params.conversationId,
        ...(afterAt || beforeAt
          ? {
              createdAt: {
                ...(afterAt ? { gt: afterAt } : {}),
                ...(beforeAt ? { lt: beforeAt } : {}),
              },
            }
          : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: params.limit,
      select: {
        id: true,
        role: true,
        text: true,
        metadata: true,
        createdAt: true,
      },
    });

    return rows
      .reverse()
      .filter((m) => isEligibleHistoryMessage(m.text))
      .map((m) => ({
        id: m.id,
        role:
          m.role === MessageRole.USER ? EMessageRole.USER : EMessageRole.MODEL,
        text: m.text,
        metadata: asJsonObject(m.metadata) ?? undefined,
        createdAt: m.createdAt,
      }));
  }

  private async resolveCreatedAt(messageId: string): Promise<Date | undefined> {
    const row = await this.prisma.conversationMessage.findUnique({
      where: { id: messageId },
      select: { createdAt: true },
    });
    return row?.createdAt;
  }
}
