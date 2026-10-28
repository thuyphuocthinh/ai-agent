import { ECheckpointRiskLevel } from '@agent/core/constants';

/**
 * Ngân sách ký tự phân bổ cho 3 thành phần ngữ cảnh trong mỗi lượt gọi LLM.
 */
export interface ContextBudget {
  toolResultCharBudget: number;
  memoryCharBudget: number;
  historyCharBudget: number;
}

/**
 * Bước thực thi công cụ được ghi nhớ trong một Skill.
 */
export interface SkillStep {
  provider: string;
  tool: string;
  argsTemplate: Record<string, unknown>;
}

/**
 * Dữ liệu đầu vào để tạo mới một Skill từ checkpoint đã duyệt thành công.
 */
export interface CreateSkillInput {
  workspaceId: string;
  taskDescription: string;
  summaryMarkdown: string;
  steps: SkillStep[];
  sourceCheckpointId: string;
  riskLevel: ECheckpointRiskLevel | null;
}

/**
 * Bản ghi Skill hoàn chỉnh dùng trong runtime và memory retrieval.
 */
export interface SkillRecord {
  id: string;
  tenantId: string;
  workspaceId: string;
  taskDescription: string;
  summaryMarkdown: string;
  steps: SkillStep[];
  sourceCheckpointIds: string[];
  approvedRunCount: number;
  riskLevel: ECheckpointRiskLevel | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Bản ghi ký ức hội thoại (thực thể / fact ổn định vừa tạo thành công).
 */
export class ConversationMemoryRecord {
  id: string;
  conversationId: string;
  sourceMessageId: string;
  tool: string;
  content: string;
  createdAt: Date;

  get channelId(): string {
    return this.conversationId;
  }
  set channelId(value: string) {
    this.conversationId = value;
  }
}

export type ConversationMemoryEntity = ConversationMemoryRecord;
export { ConversationMemoryRecord as ChannelMemoryEntity };
