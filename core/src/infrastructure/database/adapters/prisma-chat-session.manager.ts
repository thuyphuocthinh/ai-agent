import { Injectable, Logger } from '@nestjs/common';
import { v7 as uuidv7 } from 'uuid';
import {
  IChatSession,
  IChatSessionManager,
  IConversationSummary,
  EConversationState,
} from '../../../contracts';
import { PrismaService } from '../prisma.service';
import { sanitizePrismaError } from '../../../common/errors';
import { ConversationState } from '@prisma/client';
import { paginateCursor } from '../utils/prisma-paginator.util';
import { CursorPaginationQueryDto } from '../../../contracts/dtos/pagination.dto';

export const DEFAULT_DEV_USER_ID = '00000000-0000-7000-8000-000000000001';

/**
 * PrismaChatSessionManager
 * Triển khai IChatSessionManager lưu trữ bền vững trên PostgreSQL thông qua Prisma.
 * Hỗ trợ auto-provisioning cho guest/dev user mà không làm lỗi khóa ngoại userId.
 * Khử sạch 100% chi tiết lỗi SQL khi có ngoại lệ xảy ra.
 */
@Injectable()
export class PrismaChatSessionManager implements IChatSessionManager {
  private readonly logger = new Logger(PrismaChatSessionManager.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Đảm bảo bản ghi User mặc định luôn tồn tại trước khi liên kết khóa ngoại.
   */
  public async ensureDefaultUser(): Promise<void> {
    try {
      await this.prisma.user.upsert({
        where: { id: DEFAULT_DEV_USER_ID },
        update: {},
        create: {
          id: DEFAULT_DEV_USER_ID,
          email: 'admin@local.agent',
          fullName: 'Admin Developer',
          role: 'ADMIN',
        },
      });
    } catch (error) {
      throw sanitizePrismaError(error, 'PrismaChatSessionManager.ensureDefaultUser');
    }
  }

  async get(sessionId: string): Promise<IChatSession | undefined> {
    try {
      const conv = await this.prisma.conversation.findUnique({
        where: { id: sessionId },
      });

      if (!conv) {
        return undefined;
      }

      return this.mapToChatSession(conv);
    } catch (error) {
      throw sanitizePrismaError(error, 'PrismaChatSessionManager.get');
    }
  }

  async getOrCreate(sessionId?: string): Promise<IChatSession> {
    try {
      if (sessionId) {
        const existing = await this.prisma.conversation.findUnique({
          where: { id: sessionId },
        });
        if (existing) {
          return this.mapToChatSession(existing);
        }
      }

      await this.ensureDefaultUser();

      const newId = sessionId || uuidv7();
      const created = await this.prisma.conversation.create({
        data: {
          id: newId,
          userId: DEFAULT_DEV_USER_ID,
          workspaceId: 'default',
          botUserId: 'bot_default',
          title: 'Cuộc trò chuyện mới',
          channelType: 'web',
          state: ConversationState.AI_ACTIVE,
          approvalMessageIds: [],
        },
      });

      return this.mapToChatSession(created);
    } catch (error) {
      throw sanitizePrismaError(error, 'PrismaChatSessionManager.getOrCreate');
    }
  }

  async trackApproval(sessionId: string, messageId: string): Promise<void> {
    try {
      const conv = await this.prisma.conversation.findUnique({
        where: { id: sessionId },
        select: { approvalMessageIds: true },
      });

      if (!conv) {
        await this.getOrCreate(sessionId);
      }

      const currentIds = conv?.approvalMessageIds || [];
      if (!currentIds.includes(messageId)) {
        await this.prisma.conversation.update({
          where: { id: sessionId },
          data: {
            approvalMessageIds: [...currentIds, messageId],
            lastSeenAt: new Date(),
          },
        });
      }
    } catch (error) {
      throw sanitizePrismaError(error, 'PrismaChatSessionManager.trackApproval');
    }
  }

  async hasApproval(sessionId: string, messageId: string): Promise<boolean> {
    try {
      const conv = await this.prisma.conversation.findUnique({
        where: { id: sessionId },
        select: { approvalMessageIds: true },
      });

      return !!conv?.approvalMessageIds?.includes(messageId);
    } catch (error) {
      throw sanitizePrismaError(error, 'PrismaChatSessionManager.hasApproval');
    }
  }

  async setConversationState(sessionId: string, state: EConversationState): Promise<void> {
    try {
      await this.getOrCreate(sessionId);

      let prismaState: ConversationState = ConversationState.AI_ACTIVE;
      if (state === EConversationState.HUMAN_TAKEOVER) {
        prismaState = ConversationState.HUMAN_TAKEOVER;
      } else if ((state as string) === 'WAITING_FOR_APPROVAL') {
        prismaState = ConversationState.WAITING_FOR_APPROVAL;
      }

      await this.prisma.conversation.update({
        where: { id: sessionId },
        data: {
          state: prismaState,
          lastSeenAt: new Date(),
        },
      });
    } catch (error) {
      throw sanitizePrismaError(error, 'PrismaChatSessionManager.setConversationState');
    }
  }

  async getConversationState(sessionId: string): Promise<EConversationState> {
    try {
      const conv = await this.prisma.conversation.findUnique({
        where: { id: sessionId },
        select: { state: true },
      });

      if (!conv) {
        return EConversationState.AI_ACTIVE;
      }

      if (conv.state === ConversationState.HUMAN_TAKEOVER) {
        return EConversationState.HUMAN_TAKEOVER;
      }

      return EConversationState.AI_ACTIVE;
    } catch (error) {
      throw sanitizePrismaError(error, 'PrismaChatSessionManager.getConversationState');
    }
  }

  async listRecent(options?: { cursor?: string; limit?: number }): Promise<{
    data: IConversationSummary[];
    meta: { limit: number; nextCursor?: string; hasMore: boolean };
  }> {
    try {
      await this.ensureDefaultUser();

      const query: CursorPaginationQueryDto = {
        cursor: options?.cursor,
        limit: options?.limit ?? 30,
      };

      const result = await paginateCursor(
        this.prisma.conversation,
        query,
        {
          where: { userId: DEFAULT_DEV_USER_ID },
          select: {
            id: true,
            title: true,
            state: true,
            lastSeenAt: true,
            createdAt: true,
          },
          orderBy: [{ lastSeenAt: 'desc' }, { id: 'desc' }],
        },
      );

      const mappedData: IConversationSummary[] = result.data.map((item) => ({
        id: item.id,
        title: item.title || 'Cuộc trò chuyện mới',
        state:
          item.state === ConversationState.HUMAN_TAKEOVER
            ? EConversationState.HUMAN_TAKEOVER
            : EConversationState.AI_ACTIVE,
        lastSeenAt: item.lastSeenAt,
        createdAt: item.createdAt,
      }));

      return {
        data: mappedData,
        meta: result.meta,
      };
    } catch (error) {
      throw sanitizePrismaError(error, 'PrismaChatSessionManager.listRecent');
    }
  }

  async updateTitle(sessionId: string, title: string): Promise<void> {
    try {
      const cleanTitle = title.trim().slice(0, 255);
      if (!cleanTitle) return;

      await this.prisma.conversation.update({
        where: { id: sessionId },
        data: { title: cleanTitle },
      });
    } catch (error) {
      throw sanitizePrismaError(error, 'PrismaChatSessionManager.updateTitle');
    }
  }

  private mapToChatSession(conv: {
    id: string;
    userId: string;
    workspaceId: string;
    botUserId: string | null;
    approvalMessageIds: string[];
    state: ConversationState;
    title?: string | null;
    createdAt: Date;
    lastSeenAt: Date;
  }): IChatSession {
    let appState = EConversationState.AI_ACTIVE;
    if (conv.state === ConversationState.HUMAN_TAKEOVER) {
      appState = EConversationState.HUMAN_TAKEOVER;
    }

    return {
      id: conv.id,
      userId: conv.userId,
      conversationId: conv.id,
      tenantId: conv.workspaceId,
      botUserId: conv.botUserId || 'bot_default',
      approvalMessageIds: new Set(conv.approvalMessageIds || []),
      state: appState,
      title: conv.title ?? undefined,
      createdAt: conv.createdAt,
      lastSeenAt: conv.lastSeenAt,
    };
  }
}
