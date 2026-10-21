import { randomUUID } from 'crypto';
import { Injectable, Logger, Optional } from '@nestjs/common';
import {
  IMessageSink,
} from './message-sink.interface';
import {
  ChatHistoryTurnDto,
  CreateOrchestrationMessageRequestDto,
  CreateOrchestrationMessageResponseDto,
  GetMessageTextRequestDto,
  GetRecentHistoryRequestDto,
  UpdateOrchestrationMessageRequestDto,
} from './dtos/message-client.dto';
import { EMessageRole } from '@agent/core/constants';
import { ConversationMemoryService } from '../memory/conversation-memory.service';

const DEFAULT_CONVERSATION = 'default';

interface StoredMessage {
  id: string;
  conversationId: string;
  role: EMessageRole;
  text: string;
  // Chỉ message dạng chữ mới vào lịch sử hội thoại (message approval_request
  // là object JSON, không phải 1 lượt chat).
  isText: boolean;
}

@Injectable()
export class MessageClientService implements IMessageSink {
  private readonly logger = new Logger(MessageClientService.name);
  private readonly messages = new Map<string, StoredMessage>();
  private readonly order = new Map<string, string[]>();

  constructor(
    @Optional() private readonly channelMemory?: ConversationMemoryService,
  ) {}

  /** Ghi lượt của USER (trước đây không có cách nào ghi lượt user đúng role). */
  async addUserMessage(dto: {
    conversationId: string;
    text: string;
  }): Promise<CreateOrchestrationMessageResponseDto> {
    return this.store(dto.conversationId, EMessageRole.USER, dto.text);
  }

  async getMessageText(dto: GetMessageTextRequestDto): Promise<string> {
    return this.messages.get(dto.id)?.text ?? '';
  }

  async getRecentHistory(dto: GetRecentHistoryRequestDto): Promise<ChatHistoryTurnDto[]> {
    const convId = dto.conversationId ?? dto.channelId ?? DEFAULT_CONVERSATION;
    let ids = this.order.get(convId) ?? [];
    // Chỉ lấy message TRƯỚC message hiện tại (đúng như DTO mô tả) — trước đây
    // tham số này bị bỏ qua nên lịch sử lẫn cả câu hỏi hiện tại.
    const beforeIndex = ids.indexOf(dto.beforeMessageId);
    if (beforeIndex >= 0) {
      ids = ids.slice(0, beforeIndex);
    }
    const limit = dto.limit || 10;
    return ids
      .map((id) => this.messages.get(id))
      .filter((m): m is StoredMessage => Boolean(m?.isText && m.text))
      .map((m) => ({ role: m.role, text: m.text }))
      .slice(-limit);
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
    const existing = this.messages.get(dto.id);
    const convId =
      dto.conversationId ?? dto.channelId ?? existing?.conversationId ?? DEFAULT_CONVERSATION;

    // Cập nhật CHÍNH message đó để lịch sử thấy câu trả lời thật, không phải
    // chữ "Đang xử lý..." lúc mới tạo.
    if (existing) {
      existing.text = text;
      existing.isText = isText;
    } else {
      this.remember({
        id: dto.id,
        conversationId: convId,
        role: EMessageRole.MODEL,
        text,
        isText,
      });
    }

    if (convId && dto.toolCalls?.length && this.channelMemory) {
      await this.channelMemory.recordSuccessfulCreateCalls(
        convId,
        dto.id,
        dto.toolCalls,
      );
    }
  }

  async tryUpdateMessage(dto: UpdateOrchestrationMessageRequestDto): Promise<void> {
    try {
      await this.updateMessage(dto);
    } catch (error: any) {
      this.logger.error(
        `tryUpdateMessage() failed for message ${dto.id}: ${error?.message}`,
      );
    }
  }

  private store(
    conversationId: string,
    role: EMessageRole,
    content: string | Record<string, unknown>,
  ): CreateOrchestrationMessageResponseDto {
    // UUID: các cột Postgres tham chiếu message id (reply/trigger/checkpoint)
    // có kiểu uuid; id dạng "msg-1" làm mọi turn chết ngay ở lần ghi DB đầu tiên.
    const id = randomUUID();
    this.remember({
      id,
      conversationId,
      role,
      text: typeof content === 'string' ? content : JSON.stringify(content),
      isText: typeof content === 'string',
    });
    return { id };
  }

  private remember(message: StoredMessage): void {
    this.messages.set(message.id, message);
    const ids = this.order.get(message.conversationId) ?? [];
    ids.push(message.id);
    this.order.set(message.conversationId, ids);
  }
}
