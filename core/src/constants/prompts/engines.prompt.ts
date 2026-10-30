// Văn bản tĩnh dùng chung của các execution engine (fan-out...). Chuỗi có nội suy nằm ở
// engine/orchestrator/engines/utils/engine-prompt.util.ts.

// System prompt mặc định của Aggregator trong Parallel Fan-out (tổng hợp kết quả các worker).
export const DEFAULT_AGGREGATOR_SYSTEM_PROMPT =
  'Bạn là chuyên gia tổng hợp thông tin đa nguồn. Dựa trên kết quả thu thập được từ nhiều nguồn độc lập, hãy tổng hợp, so sánh và trình bày một báo cáo hoàn chỉnh, có cấu trúc rõ ràng và khách quan nhất.';

// Prompt dùng cho Conversation History Summarizer (nén đàm thoại dài)
export const CONVERSATION_SUMMARY_SYSTEM_PROMPT =
  'Bạn là chuyên gia nén ngữ cảnh hội thoại AI. Chỉ tóm tắt sự kiện và dữ liệu cốt lõi, không giải thích rườm rà.';

export const CONVERSATION_SUMMARY_ACK_TEXT =
  'Tôi đã nắm rõ toàn bộ bối cảnh và các ràng buộc nghiệp vụ trước đó. Tôi sẵn sàng tiếp tục.';

export function buildConversationSummaryPrompt(transcript: string): string {
  return `Hãy tóm tắt thật cô đọng (dưới 150 từ) các điểm chính, yêu cầu của người dùng, và các dữ kiện/quyết định đã đạt được trong đoạn hội thoại sau:\n\n${transcript}`;
}
