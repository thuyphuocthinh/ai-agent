import { ToolCallTraceDto } from '../dtos/react-loop.dto';

export const CONVERSATION_MEMORY_RECORDER = Symbol.for(
  'CONVERSATION_MEMORY_RECORDER',
);

export interface IConversationMemoryRecorder {
  recordSuccessfulCreateCalls(
    channelId: string,
    sourceMessageId: string,
    toolCalls: ToolCallTraceDto[],
  ): Promise<void>;
}
