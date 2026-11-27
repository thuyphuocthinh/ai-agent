import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { v7 as uuidv7 } from 'uuid';
import {
  IMessageSink,
  MessageEvent,
} from '../../../contracts/streaming/message-sink.interface';
import {
  ChatHistoryTurnDto,
  CreateOrchestrationMessageRequestDto,
  CreateOrchestrationMessageResponseDto,
  GetMessageTextRequestDto,
  GetRecentHistoryRequestDto,
  UpdateOrchestrationMessageRequestDto,
} from '../../../contracts/dtos/message-client.dto';
import { IMessageAttachment } from '../../../contracts/storage/storage.interface';
import { EMessageEventType, EMessageRole } from '@agent/core/constants';
import { PrismaService } from '../prisma.service';
import { sanitizePrismaError } from '../../../common/errors';
import {
  CONVERSATION_MEMORY_RECORDER,
  IConversationMemoryRecorder,
} from '../../../contracts/memory/conversation-memory-recorder.interface';
import { MessageRole, Prisma } from '@prisma/client';
import { trimTurnsToCharBudget } from '../../../common/text/context-edit.util';
import { asJsonObject } from '../../../common/text/structured-payload.util';
import { resolveHistoryCharBudget } from '../../../common/text/token-budget.util';
import { isEligibleHistoryMessage } from '../utils/prisma-history-filter.util';
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
    @Optional()
    @Inject(CONVERSATION_MEMORY_RECORDER)
    private readonly channelMemory?: IConversationMemoryRecorder,
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
    attachments?: IMessageAttachment[];
  }): Promise<CreateOrchestrationMessageResponseDto> {
    return this.store(dto.conversationId, EMessageRole.USER, dto.text, dto.attachments);
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
          attachments: true,
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

      const turns = eligible
        .filter((m, idx) => {
          const hasText = Boolean(m.text && m.text.trim());
          const metaObj = asJsonObject(m.metadata);
          const hasMetadata = Boolean(metaObj && Object.keys(metaObj).length > 0);
          const isLatest = idx === eligible.length - 1;
          return hasText || hasMetadata || isLatest;
        })
        .filter((m) => isEligibleHistoryMessage(m.text))
        .map((m) => ({
          id: m.id,
          role: m.role === MessageRole.USER ? EMessageRole.USER : EMessageRole.MODEL,
          text: m.text,
          attachments:
            Array.isArray(m.attachments) && m.attachments.length > 0
              ? (m.attachments as unknown as IMessageAttachment[])
              : undefined,
          metadata: asJsonObject(m.metadata) ?? undefined,
          createdAt: m.createdAt,
        }))
        .slice(-limit);
      return trimTurnsToCharBudget(turns, resolveHistoryCharBudget(''));
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

      const existingMetadata = asJsonObject(existing.metadata) ?? {};

      const updatedMetadata: Prisma.InputJsonObject = {
        ...existingMetadata,
        ...(typeof dto.content === 'object' && dto.content !== null
          ? { contentPayload: JSON.parse(JSON.stringify(dto.content)) }
          : {}),
        ...(dto.toolCalls ? { toolCalls: JSON.parse(JSON.stringify(dto.toolCalls)) } : {}),
        ...(dto.steps ? { steps: JSON.parse(JSON.stringify(dto.steps)) } : {}),
        ...(dto.persona ? { persona: JSON.parse(JSON.stringify(dto.persona)) } : {}),
        ...(dto.personas ? { personas: JSON.parse(JSON.stringify(dto.personas)) } : {}),
        ...(dto.routing ? { routing: JSON.parse(JSON.stringify(dto.routing)) } : {}),
        ...(dto.executionTimeMs !== undefined ? { executionTimeMs: dto.executionTimeMs } : {}),
      };

      const isPauseIndicator =
        typeof dto.content === 'string' &&
        (dto.content.startsWith('⏸️') ||
          dto.content.includes('Cần bạn duyệt') ||
          dto.content.includes('Cần bạn làm rõ'));

      const finalText = isPauseIndicator ? existing.text : text;

      await this.prisma.conversationMessage.update({
        where: { id: dto.id },
        data: {
          text: finalText,
          isText,
          metadata: updatedMetadata,
          latencyMs: dto.executionTimeMs,
        },
      });

      this.notify({
        type: EMessageEventType.UPDATED,
        id: dto.id,
        conversationId: existing.conversationId,
        role: existing.role === MessageRole.USER ? EMessageRole.USER : EMessageRole.MODEL,
        content: dto.content,
      });
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
    attachments?: IMessageAttachment[],
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
          attachments:
            attachments && attachments.length > 0
              ? (attachments as unknown as Prisma.InputJsonValue)
              : [],
        },
      });

      this.notify({
        type: EMessageEventType.CREATED,
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
