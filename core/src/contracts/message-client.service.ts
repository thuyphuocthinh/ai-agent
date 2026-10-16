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
import { ChannelMemoryService } from '../memory/channel-memory.service';

@Injectable()
export class MessageClientService implements IMessageSink {
  private readonly logger = new Logger(MessageClientService.name);
  private readonly messages = new Map<string, string>();
  private readonly history = new Map<string, ChatHistoryTurnDto[]>();
  private messageCounter = 0;

  constructor(
    @Optional() private readonly channelMemory?: ChannelMemoryService,
  ) {}

  async getMessageText(dto: GetMessageTextRequestDto): Promise<string> {
    return this.messages.get(dto.id) || '';
  }

  async getRecentHistory(dto: GetRecentHistoryRequestDto): Promise<ChatHistoryTurnDto[]> {
    const turns = this.history.get(dto.channelId) || [];
    const limit = dto.limit || 10;
    return turns.slice(-limit);
  }

  async createMessage(
    dto: CreateOrchestrationMessageRequestDto,
  ): Promise<CreateOrchestrationMessageResponseDto> {
    const id = `msg-${++this.messageCounter}`;
    const text = typeof dto.content === 'string' ? dto.content : JSON.stringify(dto.content);
    this.messages.set(id, text);

    const turns = this.history.get(dto.channelId) || [];
    turns.push({
      role: EMessageRole.MODEL,
      text,
    });
    this.history.set(dto.channelId, turns);

    return { id };
  }

  async updateMessage(dto: UpdateOrchestrationMessageRequestDto): Promise<void> {
    const text = typeof dto.content === 'string' ? dto.content : JSON.stringify(dto.content);
    this.messages.set(dto.id, text);

    if (dto.channelId && dto.toolCalls?.length && this.channelMemory) {
      await this.channelMemory.recordSuccessfulCreateCalls(
        dto.channelId,
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
}
