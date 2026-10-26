import { Injectable, Logger, Optional } from '@nestjs/common';
import { v7 as uuidv7 } from 'uuid';
import {
  IMessageSink,
  MessageEvent,
} from '../../../contracts/message-sink.interface';
import {
  ChatHistoryTurnDto,
  CreateOrchestrationMessageRequestDto,
  CreateOrchestrationMessageResponseDto,
  GetMessageTextRequestDto,
  GetRecentHistoryRequestDto,
  UpdateOrchestrationMessageRequestDto,
} from '../../../contracts/dtos/message-client.dto';
import { EMessageRole } from '@agent/core/constants';
import { PrismaService } from '../prisma.service';
import { sanitizePrismaError } from '../../../common/errors';
import { ConversationMemoryService } from '../../../memory/conversation-memory.service';
import { MessageRole, Prisma } from '@prisma/client';
import { DEFAULT_DEV_USER_ID } from './prisma-chat-session.manager';

const DEFAULT_CONVERSATION = '00000000-0000-7000-8000-000000000002';

/**
 * PrismaMessageSink
 * Triển khai IMessageSink lưu trữ vĩnh viễn các lượt chat vào PostgreSQL qua Prisma.
 * Hỗ trợ lưu trữ metadata execution traces (rounds, tool calls) để phục vụ F5 page reload.
 * Đảm bảo 100% không để lộ câu lệnh SQL khi có sự cố.
 */
@Injectable()
export class PrismaMessageSink implements IMessageSink {
  private readonly logger = new Logger(PrismaMessageSink.name);
  private readonly listeners = new Set<(event: MessageEvent) => void>();

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly channelMemory?: ConversationMemoryService,
  ) {}

  /**
   * Lắng nghe sự kiện message được tạo hoặc cập nhật (dành cho WebSockets / SSE UI streaming).
   */
  onMessage(listener: (event: MessageEvent) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(event: MessageEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (err) {
        this.logger.warn(`Lỗi khi phát sự kiện message event listener: ${(err as Error).message}`);
      }
    }
  }

  private async ensureConversation(conversationId: string): Promise<void> {
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

      await this.prisma.conversation.upsert({
        where: { id: conversationId },
        update: {
          lastSeenAt: new Date(),
        },
        create: {
          id: conversationId,
          userId: DEFAULT_DEV_USER_ID,
          workspaceId: 'default',
          title: 'Cuộc trò chuyện mới',
          state: 'AI_ACTIVE',
        },
      });
    } catch (error) {
      throw sanitizePrismaError(error, 'PrismaMessageSink.ensureConversation');
    }
  }

  async addUserMessage(dto: {
    conversationId: string;
    text: string;
  }): Promise<CreateOrchestrationMessageResponseDto> {
    return this.store(dto.conversationId, EMessageRole.USER, dto.text);
  }

  async getMessageText(dto: GetMessageTextRequestDto): Promise<string> {
    try {
      const msg = await this.prisma.conversationMessage.findUnique({
        where: { id: dto.id },
        select: { text: true },
      });
      return msg?.text ?? '';
    } catch (error) {
      throw sanitizePrismaError(error, 'PrismaMessageSink.getMessageText');
    }
  }

  async getRecentHistory(dto: GetRecentHistoryRequestDto): Promise<ChatHistoryTurnDto[]> {
    try {
      const convId = dto.conversationId ?? dto.channelId ?? DEFAULT_CONVERSATION;
      const limit = dto.limit || 10;

      const messages = await this.prisma.conversationMessage.findMany({
        where: {
          conversationId: convId,
          isText: true,
        },
        orderBy: {
          createdAt: 'asc',
        },
        select: {
          id: true,
          role: true,
          text: true,
          metadata: true,
          createdAt: true,
        },
      });

      let eligible = messages;
      if (dto.beforeMessageId) {
        const targetIdx = messages.findIndex((m) => m.id === dto.beforeMessageId);
        if (targetIdx >= 0) {
          eligible = messages.slice(0, targetIdx);
        }
      }

      return eligible
        .filter((m) => Boolean(m.text && m.text.trim()))
        .filter((m, idx, arr) => {
          if (
            m.text.includes('⏸️ Cần bạn duyệt') ||
            m.text.includes('Cần bạn duyệt 1 hành động')
          ) {
            const hasLaterModelMsg = arr
              .slice(idx + 1)
              .some((later) => later.role === MessageRole.ASSISTANT);
            return !hasLaterModelMsg;
          }
          return true;
        })
        .map((m) => ({
          id: m.id,
          role: m.role === MessageRole.USER ? EMessageRole.USER : EMessageRole.MODEL,
          text: m.text,
          metadata:
            m.metadata && typeof m.metadata === 'object' && !Array.isArray(m.metadata)
              ? (m.metadata as Record<string, unknown>)
              : undefined,
          createdAt: m.createdAt,
        }))
        .slice(-limit);
    } catch (error) {
      throw sanitizePrismaError(error, 'PrismaMessageSink.getRecentHistory');
    }
  }

  async createMessage(
    dto: CreateOrchestrationMessageRequestDto,
  ): Promise<CreateOrchestrationMessageResponseDto> {
    const convId = dto.conversationId ?? dto.channelId ?? DEFAULT_CONVERSATION;
    return this.store(convId, EMessageRole.MODEL, dto.content);
  }

  async updateMessage(dto: UpdateOrchestrationMessageRequestDto): Promise<void> {
    const text = typeof dto.content === 'string' ? dto.content : JSON.stringify(dto.content);
    const isText = typeof dto.content === 'string';

    try {
      let existing = await this.prisma.conversationMessage.findUnique({
        where: { id: dto.id },
      });

      const convId = dto.conversationId ?? dto.channelId ?? DEFAULT_CONVERSATION;

      if (!existing) {
        await this.ensureConversation(convId);
        existing = await this.prisma.conversationMessage.create({
          data: {
            id: dto.id,
            conversationId: convId,
            role: MessageRole.ASSISTANT,
            text,
            isText,
            metadata: {},
          },
        });
      }

      const existingMetadata =
        existing.metadata && typeof existing.metadata === 'object' && !Array.isArray(existing.metadata)
          ? (existing.metadata as Record<string, unknown>)
          : {};

      const updatedMetadata: Prisma.InputJsonObject = {
        ...existingMetadata,
        ...(typeof dto.content === 'object' && dto.content !== null
          ? { contentPayload: JSON.parse(JSON.stringify(dto.content)) }
          : {}),
        ...(dto.toolCalls ? { toolCalls: JSON.parse(JSON.stringify(dto.toolCalls)) } : {}),
        ...(dto.steps ? { steps: JSON.parse(JSON.stringify(dto.steps)) } : {}),
        ...(dto.persona ? { persona: JSON.parse(JSON.stringify(dto.persona)) } : {}),
        ...(dto.personas ? { personas: JSON.parse(JSON.stringify(dto.personas)) } : {}),
        ...(dto.executionTimeMs !== undefined ? { executionTimeMs: dto.executionTimeMs } : {}),
      };

      await this.prisma.conversationMessage.update({
        where: { id: dto.id },
        data: {
          text,
          isText,
          metadata: updatedMetadata,
          latencyMs: dto.executionTimeMs,
        },
      });

      this.notify({
        type: 'updated',
        id: dto.id,
        conversationId: existing.conversationId,
        role: existing.role === MessageRole.USER ? EMessageRole.USER : EMessageRole.MODEL,
        content: dto.content,
      });

      if (dto.toolCalls && dto.toolCalls.length > 0 && this.channelMemory) {
        const convId = dto.conversationId ?? dto.channelId ?? existing.conversationId;
        await this.channelMemory.recordSuccessfulCreateCalls(
          convId,
          dto.id,
          dto.toolCalls as any,
        );
      }
    } catch (error) {
      throw sanitizePrismaError(error, 'PrismaMessageSink.updateMessage');
    }
  }

  async tryUpdateMessage(dto: UpdateOrchestrationMessageRequestDto): Promise<void> {
    try {
      await this.updateMessage(dto);
    } catch (err) {
      this.logger.warn(`tryUpdateMessage bỏ qua lỗi: ${(err as Error).message}`);
    }
  }

  private async store(
    conversationId: string,
    role: EMessageRole,
    content: string | Record<string, unknown>,
  ): Promise<CreateOrchestrationMessageResponseDto> {
    const id = uuidv7();
    const text = typeof content === 'string' ? content : JSON.stringify(content);
    const isText = typeof content === 'string';
    const metadata = typeof content === 'object' && content !== null ? (content as Prisma.InputJsonValue) : {};

    try {
      await this.ensureConversation(conversationId);

      const prismaRole = role === EMessageRole.USER ? MessageRole.USER : MessageRole.ASSISTANT;

      await this.prisma.conversationMessage.create({
        data: {
          id,
          conversationId,
          role: prismaRole,
          text,
          isText,
          metadata,
        },
      });

      this.notify({
        type: 'created',
        id,
        conversationId,
        role,
        content,
      });

      return { id };
    } catch (error) {
      throw sanitizePrismaError(error, 'PrismaMessageSink.store');
    }
  }
}
