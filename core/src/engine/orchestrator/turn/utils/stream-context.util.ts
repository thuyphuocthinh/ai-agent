import { AgentStreamContext } from '../../../../contracts/streaming/stream-sink.interface';
import { IProcessAiTriggerJobData } from '../../../../contracts/queue/job-data.interface';

export interface TurnChannel {
  conversationId: string;
  sessionType: string;
}

// Hội thoại và loại phiên của một turn, suy ra từ job data (channelId/channelType là
// alias cũ của conversationId/sessionType).
export function resolveTurnChannel(data: IProcessAiTriggerJobData): TurnChannel {
  return {
    conversationId: data.conversationId ?? data.channelId,
    sessionType: data.sessionType ?? data.channelType ?? 'direct',
  };
}

// Ngữ cảnh để emit step/token lên đúng bubble của bot reply (kèm cặp alias cũ
// channelId/channelType). `streamKey` chỉ có mặt khi được truyền.
export function buildChannelStreamContext(
  userId: string,
  conversationId: string,
  sessionType: string,
  messageId: string,
  streamKey?: string,
): AgentStreamContext {
  return {
    userId,
    conversationId,
    channelId: conversationId,
    messageId,
    sessionType,
    channelType: sessionType,
    ...(streamKey !== undefined ? { streamKey } : {}),
  };
}

export function buildStreamContext(
  data: IProcessAiTriggerJobData,
  messageId: string,
  streamKey?: string,
): AgentStreamContext {
  const { conversationId, sessionType } = resolveTurnChannel(data);
  return buildChannelStreamContext(
    data.userId,
    conversationId,
    sessionType,
    messageId,
    streamKey,
  );
}
