import { ApiPropertyOptional } from '@nestjs/swagger';
import { EStepExecutionStatus, EMessageRole } from '@agent/core/constants';
import { PersonaDto } from './supervisor.dto';
import { IMessageAttachment } from '../storage/storage.interface';
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

export interface IMessageToolCallItem {
  toolCallId?: string;
  tool: string;
  status: EStepExecutionStatus;
  resultPreview?: string;
  argsPreview?: string;
}

export class ExecutedStepDto {
  agent: string;
  task: string;
  persona?: PersonaDto;
  toolCalls: IMessageToolCallItem[];
  result?: string;
}

/**
 * Quyết định định tuyến của turn, lưu vào metadata của reply để giao diện dựng lại
 * card Supervisor sau khi reload (lúc đang stream thì card tự dựng từ chính stream).
 */
export interface TurnRoutingDto {
  /** Engine xử lý turn (single_agent, dynamic_supervisor, ...) hoặc 'workflow'. */
  mode: string;
  /** Tên workflow khi mode = 'workflow'. */
  label?: string;
}

export class UpdateOrchestrationMessageRequestDto {
  id: string;
  userId?: string;
  // object — Giai đoạn 3 (HITL) cần re-send content dạng object khi update
  // message "approval_request" kèm toolCalls (xem pauseForApproval()).
  content: string | Record<string, unknown>;
  toolCalls?: IMessageToolCallItem[];
  steps?: ExecutedStepDto[];
  persona?: PersonaDto;
  personas?: PersonaDto[];
  routing?: TurnRoutingDto;
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
  id?: string;
  role: EMessageRole;
  text: string;

  @ApiPropertyOptional({
    description: 'Danh sách tệp đính kèm (hình ảnh, tài liệu) liên quan đến lượt chat',
    example: [{ type: 'image', url: 'https://storage.mycompany.com/temp/invoices/inv-001.jpg' }],
  })
  attachments?: IMessageAttachment[];

  metadata?: Record<string, unknown>;
  createdAt?: Date;
}
