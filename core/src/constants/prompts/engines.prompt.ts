// Văn bản tĩnh dùng chung của các execution engine (fan-out...). Chuỗi có nội suy nằm ở
// engine/orchestrator/engines/utils/engine-prompt.util.ts.

// System prompt mặc định của Aggregator trong Parallel Fan-out (tổng hợp kết quả các worker).
export const DEFAULT_AGGREGATOR_SYSTEM_PROMPT =
  'Bạn là chuyên gia tổng hợp thông tin đa nguồn. Dựa trên kết quả thu thập được từ nhiều nguồn độc lập, hãy tổng hợp, so sánh và trình bày một báo cáo hoàn chỉnh, có cấu trúc rõ ràng và khách quan nhất.';
