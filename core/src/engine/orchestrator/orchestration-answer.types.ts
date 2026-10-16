import { ToolCallTraceDto } from '../../contracts/dtos/react-loop.dto';
import { SupervisorRoundDto } from '../../contracts/dtos/supervisor.dto';
import { PendingToolCall } from '../../infrastructure/database/entities/orchestration-checkpoint.entity';

// Object content (approval_request) đi qua createMessage() riêng, không qua đây.
export interface AnswerResult {
  content: string;
  toolCalls?: ToolCallTraceDto[];
}

export interface DelegateRoundResult {
  round: SupervisorRoundDto;
  toolCalls: ToolCallTraceDto[];
}

// delegateRound() trả dạng này thay vì throw khi bị Risk Gate chặn, để
// Promise.all() không mất kết quả của delegation anh em chạy song song.
export interface ApprovalRequiredDelegateResult {
  approvalRequired: PendingToolCall;
  task: string;
  toolCalls: ToolCallTraceDto[];
}

export function buildAnswer(
  content: string,
  toolCalls: ToolCallTraceDto[],
): AnswerResult {
  return { content, toolCalls: toolCalls.length > 0 ? toolCalls : undefined };
}
