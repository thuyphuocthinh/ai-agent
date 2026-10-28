import { DelegationDto, SupervisorRoundDto } from './supervisor.dto';
import { ChatHistoryTurnDto } from './message-client.dto';
import { ToolCallTraceDto } from './react-loop.dto';
import { ECheckpointKind, ECheckpointRiskLevel } from '@agent/core/constants';

export enum OrchestrationCheckpointStatus {
  PENDING = 'pending',
  APPROVED = 'approved',
  REJECTED = 'rejected',
}

export interface PendingToolCall {
  provider: string;
  name: string;
  args: Record<string, unknown>;
}

export interface AmbiguousAgentCandidate {
  provider: string;
  label: string;
}

export class CreateCheckpointRequestDto {
  replyMessageId: string;
  runId?: string;
  userId: string;
  botUserId?: string;
  channelId: string;
  conversationId?: string;
  workspaceId?: string;
  tenantId?: string;
  channelType?: string;
  sessionType?: string;
  originalPrompt: string;
  pendingTool: PendingToolCall | null;
  pendingTask: string;
  roundsSoFar: SupervisorRoundDto[];
  toolCalls?: ToolCallTraceDto[];
  history: ChatHistoryTurnDto[];
  kind?: ECheckpointKind;
  riskLevel?: ECheckpointRiskLevel | null;
  clarificationQuestion?: string | null;
  clarificationCandidates?: AmbiguousAgentCandidate[] | null;
  remainingSteps?: DelegationDto[];
  engineMode?: string;
  selectedCandidateId?: string;
}

// Response cho create()/findPendingByReplyMessageId()/findById()/findExpiredPending()
// — không trả thẳng OrchestrationCheckpointEntity (ORM) ra ngoài CheckpointService.
export class CheckpointResponseDto {
  id: string;
  replyMessageId: string;
  runId?: string;
  userId: string;
  botUserId: string;
  channelId: string;
  conversationId?: string;
  workspaceId: string;
  tenantId?: string;
  channelType: string;
  sessionType?: string;
  originalPrompt: string;
  pendingTool: PendingToolCall | null;
  pendingTask: string;
  roundsSoFar: SupervisorRoundDto[];
  toolCalls?: ToolCallTraceDto[];
  remainingSteps: DelegationDto[];
  history: ChatHistoryTurnDto[];
  status: OrchestrationCheckpointStatus;
  kind: ECheckpointKind;
  riskLevel: ECheckpointRiskLevel | null;
  clarificationQuestion: string | null;
  clarificationCandidates: AmbiguousAgentCandidate[] | null;
  selectedProvider: string | null;
  selectedCandidateId?: string | null;
  engineMode?: string;
  expiresAt: Date;
  toolExecutedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export class FindPendingCheckpointRequestDto {
  replyMessageId: string;
}

export class FindPendingByConversationRequestDto {
  conversationId: string;
}

// Giai đoạn 3 (HITL) — dùng trong job PROCESS_APPROVAL để fetch lại checkpoint
// SAU khi đã claim() (status không còn 'pending' nữa nên findPendingBy... không tìm ra).
export class FindCheckpointByIdRequestDto {
  id: string;
}

// Giai đoạn 3 (HITL) — atomic conditional update (WHERE id = ? AND status =
// 'pending'), KHÔNG phải find-rồi-update rời: chặn race 2 request
// approve/reject cùng lúc (double-click, nhiều tab) khiến tool nguy hiểm bị
// thực thi 2 lần.
export class ClaimCheckpointRequestDto {
  id: string;
  toStatus: OrchestrationCheckpointStatus;
  selectedProvider?: string;
  updatedPendingTool?: PendingToolCall | null;
}

export class ClaimCheckpointResponseDto {
  claimed: boolean;
}

// Giai đoạn 4, Step 1 — atomic conditional update (WHERE execution_started_at
// IS NULL), tách riêng khỏi claim() (status): chặn processApprovalJob() thực
// thi tool THẬT (mcpClient.callTool()) lần 2 nếu job bị BullMQ redeliver
// (stalled), bất kể attempts:1 có chặn được redelivery hay không.
export class ClaimCheckpointExecutionRequestDto {
  id: string;
}

// Bug fix — dọn checkpoint status=APPROVED bị kẹt sau worker crash (không dùng
// được claim() vốn chỉ UPDATE WHERE status=PENDING).
export class MarkStalledAsRejectedRequestDto {
  id: string;
}

// Bug fix — set NGAY SAU KHI tool thật chạy xong thành công, để
// recoverStalledExecutions() phân biệt được "chưa chạy" với "đã chạy, crash
// lúc tổng hợp câu trả lời".
export class MarkToolExecutedRequestDto {
  id: string;
}
