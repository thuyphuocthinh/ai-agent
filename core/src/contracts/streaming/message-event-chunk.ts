import type { UIMessageChunk } from 'ai';
import {
  ECheckpointKind,
  EMessageContentType,
  EMessageEventType,
  EVercelStreamChunkType,
} from '@agent/core/constants';
import { MessageEvent } from './message-sink.interface';

/**
 * Chuyển event message (không đi qua step của engine) thành chunk UI:
 * yêu cầu duyệt, yêu cầu làm rõ, và câu trả lời cuối của reply đang theo dõi.
 * Dùng chung cho stream live (TurnStreamFactory) và bản ghi event log
 * (TurnEventRecorderService) để 2 đường cho ra đúng cùng 1 chunk.
 * Caller tự lọc role/conversation.
 */
export function messageEventToChunk(
  event: MessageEvent,
  replyMessageId?: string,
): UIMessageChunk | null {
  if (event.type === EMessageEventType.CREATED) {
    if (typeof event.content !== 'object') return null;
    const content = event.content as Record<string, unknown>;

    if (content.type === EMessageContentType.APPROVAL_REQUEST) {
      return {
        type: EVercelStreamChunkType.DATA_APPROVAL,
        data: {
          messageId: event.id,
          tool: content.tool,
          preview: content.preview,
          friendlySummary: content.friendlySummary,
        },
      };
    }
    if (content.type === EMessageContentType.CLARIFICATION_REQUEST) {
      return {
        type: EVercelStreamChunkType.DATA_CLARIFICATION,
        data: {
          messageId: event.id,
          kind: ECheckpointKind.CLARIFICATION,
          preview: content.question,
          friendlySummary: content.question,
          candidates: content.candidates,
        },
      };
    }
    return null;
  }

  if (event.id === replyMessageId && typeof event.content === 'string') {
    return {
      type: EVercelStreamChunkType.DATA_REPLY,
      data: { messageId: event.id, text: event.content },
    };
  }
  return null;
}
