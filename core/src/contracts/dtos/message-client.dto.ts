import { EStepExecutionStatus, EMessageRole } from '@agent/core/constants';
export class CreateOrchestrationMessageRequestDto {
  channelId?: string;
  conversationId?: string;
  senderId?: string;
  userId?: string;
  // object — Giai đoạn 3 (HITL) dùng để tạo message "approval_request"
  // ({type, tool, args, status}), không chỉ text thường.
  content: string | Record<string, unknown>;
}

export class CreateOrchestrationMessageResponseDto {
  id: string;
}

export class UpdateOrchestrationMessageRequestDto {
  id: string;
  userId?: string;
  // object — Giai đoạn 3 (HITL) cần re-send content dạng object khi update
  // message "approval_request" kèm toolCalls (xem pauseForApproval()).
  content: string | Record<string, unknown>;
  toolCalls?: {
    tool: string;
    status: EStepExecutionStatus;
    resultPreview?: string;
  }[];
  // Optional: ghi nhớ channel_memory / conversation_memory
  channelId?: string;
  conversationId?: string;
  executionTimeMs?: number;
}

export class GetMessageTextRequestDto {
  id: string;
  userId: string;
}

export class GetRecentHistoryRequestDto {
  channelId?: string;
  conversationId?: string;
  userId: string;
  // Chỉ lấy message TRƯỚC message này (không tính chính nó)
  beforeMessageId: string;
  limit: number;
  // Lưới an toàn ký tự cuối cùng (resolveHistoryCharBudget), KHÔNG thay cơ
  // chế turn-count hiện có. Không truyền = giữ nguyên hành vi cũ (không cắt
  // thêm theo ký tự).
  charBudget?: number;
}

export class ChatHistoryTurnDto {
  role: EMessageRole;
  text: string;
}
