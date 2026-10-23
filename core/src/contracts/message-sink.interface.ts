import {
  ChatHistoryTurnDto,
  CreateOrchestrationMessageRequestDto,
  CreateOrchestrationMessageResponseDto,
  GetMessageTextRequestDto,
  GetRecentHistoryRequestDto,
  UpdateOrchestrationMessageRequestDto,
} from './dtos/message-client.dto';

export const MESSAGE_SINK = Symbol('MESSAGE_SINK');

export interface IMessageSink {
  getMessageText(dto: GetMessageTextRequestDto): Promise<string>;
  getRecentHistory(dto: GetRecentHistoryRequestDto): Promise<ChatHistoryTurnDto[]>;
  createMessage(
    dto: CreateOrchestrationMessageRequestDto,
  ): Promise<CreateOrchestrationMessageResponseDto>;
  updateMessage(dto: UpdateOrchestrationMessageRequestDto): Promise<void>;
  tryUpdateMessage(dto: UpdateOrchestrationMessageRequestDto): Promise<void>;
  addUserMessage(dto: {
    conversationId: string;
    text: string;
  }): Promise<CreateOrchestrationMessageResponseDto>;
}
