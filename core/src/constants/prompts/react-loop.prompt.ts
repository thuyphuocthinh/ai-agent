// Văn bản tĩnh của system prompt trong ReAct loop (nội dung bổ sung vào
// ORCHESTRATION_SYSTEM_PROMPT). Chuỗi có nội suy nằm ở
// engine/loop/utils/react-loop-prompt.util.ts.

// Tiêu đề khối Context/Resources (resource MCP) đưa vào bộ nhớ của agent.
export const RESOURCES_PROMPT_HEADER =
  'Bạn có sẵn các Context/Resources sau trong bộ nhớ để tham khảo, tuyệt đối ưu tiên sử dụng thông tin này nếu liên quan đến câu hỏi của người dùng:';

// Context-Aware Policy Grounding: quy chế doanh nghiệp liên quan tới yêu cầu.
export const POLICY_GROUNDING_TITLE =
  '--- QUY CHẾ DOANH NGHIỆP BẮT BUỘC (ENTERPRISE POLICIES) ---';
export const POLICY_GROUNDING_INTRO =
  'Các quy chế sau đây áp dụng trực tiếp cho yêu cầu của người dùng:';
export const POLICY_ENFORCEMENT_HEADING = 'NGUYÊN TẮC THI HÀNH BẮT BUỘC:';
export const POLICY_ENFORCEMENT_TEXT =
  'Nếu yêu cầu của người dùng thuộc phạm vi cần phê duyệt (REQUIRE_APPROVAL) hoặc bị nghiêm cấm (DENY), bạn TUYỆT ĐỐI KHÔNG ĐƯỢC tự ý sinh script, file cấu hình (YAML, JSON), hoặc viết hướng dẫn chi tiết để người dùng tự làm thủ công nhằm lách quy chế. Hãy thông báo rõ ràng về điều khoản quy định và hướng dẫn người dùng xin phê duyệt từ cấp quản lý có thẩm quyền.';

// Câu trả lời khi hết MAX_REACT_STEPS mà model chưa có nội dung.
export const MAX_STEPS_FALLBACK_ANSWER =
  'Xin lỗi, câu hỏi này cần nhiều bước hơn mình hỗ trợ được.';

// Nối vào câu trả lời hết bước khi đã có tool chạy THÀNH CÔNG (có khoảng trắng đầu).
export const PARTIAL_WRITE_CAVEAT =
  ' Một số hành động (đọc/ghi dữ liệu) đã thực hiện THÀNH CÔNG trước khi dừng — kiểm tra lại kết quả hiện có trước khi yêu cầu lại, tránh lặp lại đúng thao tác đã làm.';

// Gợi ý khi chặn tool lặp lại mà không còn tool nào khác trong hệ thống để thử.
export const NO_OTHER_TOOLS_SUGGESTION =
  'Không còn tool nào khác của hệ thống này để thử.';

// --- Trí nhớ dài hạn (Semantic Recall) ---
export const RECALLED_MEMORIES_HEADER =
  '=== KÝ ỨC VÀ SỰ THẬT ĐÃ BIẾT VỀ NGƯỜI DÙNG ===';
export const RECALLED_MEMORIES_FOOTER =
  '===============================================';

// --- Hướng dẫn phục hồi lỗi công cụ (Self-Healing & Fail-Fast Ceiling) ---
export const TOOL_ERROR_RECOVERY_PREFIX = '[LỖI THỰC THI CÔNG CỤ]:';
export const TOOL_ERROR_SELF_HEAL_HINT =
  '[HƯỚNG DẪN TỰ SỬA]: Công cụ gặp lỗi trên. Hãy kiểm tra lại tham số, cấu trúc bảng/dữ liệu hoặc đổi phương án gọi tool khác. Tuyệt đối không gọi lại công cụ với các tham số y hệt mà không thay đổi gì.';
export const TOOL_ERROR_FAIL_FAST_PREFIX = '[DỪNG THỬ LẠI - FAIL-FAST]:';

// Ghi chú đính kèm khi offload dữ liệu lớn ra đĩa tạm (Direct-to-Disk)
export const DIRECT_TO_DISK_OFFLOAD_NOTE =
  'Dữ liệu lớn (> 50KB) đã được lưu ra file tạm an toàn để tiết kiệm Token. Dùng Python Compute Sandbox đọc file này để xử lý.';

