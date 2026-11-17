export enum EMessageRole {
  USER = 'user',
  MODEL = 'model',
  SYSTEM = 'system',
  TOOL = 'tool',
}

export interface ChatHistoryTurnDto {
  role: EMessageRole;
  text: string;
}

export interface CreateOrchestrationMessageRequestDto {
  channelId?: string;
  conversationId?: string;
  senderId?: string;
  userId?: string;
  content: string | Record<string, unknown>;
}

export interface CreateOrchestrationMessageResponseDto {
  id: string;
}

export interface UpdateOrchestrationMessageRequestDto {
  id: string;
  userId?: string;
  content: string | Record<string, unknown>;
  toolCalls?: {
    tool: string;
    status: string;
    resultPreview?: string;
  }[];
  channelId?: string;
  conversationId?: string;
  executionTimeMs?: number;
}

export interface GetMessageTextRequestDto {
  id: string;
  userId?: string;
}

export interface GetRecentHistoryRequestDto {
  channelId?: string;
  conversationId?: string;
  userId?: string;
  beforeMessageId?: string;
  limit?: number;
  charBudget?: number;
}

export interface AgentStreamContext {
  userId?: string;
  conversationId?: string;
  channelId?: string;
  messageId?: string;
  sessionType?: string;
  channelType?: string;
  streamKey?: string;
}

export interface AgentStreamStep {
  type: string;
  tool?: string;
  status?: string;
  resultPreview?: string;
  argsPreview?: string;
  text?: string;
  label?: string;
  kind?: string;
  toolCallId?: string;
  friendlySummary?: string;
}

export const MESSAGE_SINK = Symbol('MESSAGE_SINK');
export const STREAM_SINK = Symbol('STREAM_SINK');

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
    attachments?: any[];
  }): Promise<CreateOrchestrationMessageResponseDto>;
}

export interface IStreamSink {
  emitStep(context: AgentStreamContext, step: AgentStreamStep): Promise<void>;
  emitToken(context: AgentStreamContext, token: string): Promise<void>;
  flush(): Promise<void>;
}
