/**
 * Ngân sách ký tự phân bổ cho 3 thành phần ngữ cảnh trong mỗi lượt gọi LLM.
 */
export interface ContextBudget {
  toolResultCharBudget: number;
  memoryCharBudget: number;
  historyCharBudget: number;
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
