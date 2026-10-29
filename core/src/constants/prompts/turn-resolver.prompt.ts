// Văn bản tĩnh và marker trong luồng lập kế hoạch/ủy quyền của TurnResolverRun. Chuỗi có
// nội suy nằm ở engine/orchestrator/turn/utils/turn-resolver-prompt.util.ts.

// Marker mở đầu `result` của round KHÔNG phải tiến triển thật (bị chặn hoặc lập lại kế hoạch).
export const GUARDRAIL_BLOCKED_MARKER = 'Bỏ qua bước này';
export const REPLAN_MARKER = '[re-plan]';

// Phần sau marker khi evaluate() yêu cầu lập lại kế hoạch (có khoảng trắng đầu).
export const REPLAN_RESULT_DETAIL =
  ' evaluate() cho rằng bước vừa xong không đạt kỳ vọng, đã lập lại kế hoạch.';

// Hậu tố của task khi chỉ lấy phần dữ liệu đã thu thập trước khi cần duyệt một hành động khác.
export const PARTIAL_STEP_TASK_SUFFIX =
  ' (dữ liệu đã thu thập được TRƯỚC KHI cần duyệt 1 hành động khác trong cùng bước này)';

// Khối bối cảnh khi ủy quyền một bước cho agent (delegateRound).
export const ORIGINAL_PROMPT_CONTEXT_HEADER =
  'Yêu cầu gốc đầy đủ của user cho turn này (dùng để lấy đúng dữ liệu/số liệu cụ thể nếu task ở trên chỉ tóm tắt lại, TUYỆT ĐỐI không tự bịa dữ liệu khi task tóm tắt bị thiếu).';
// Chỉ thêm khi kế hoạch còn bước khác: không có, worker làm luôn phần việc của các bước kia.
export const SCOPE_LIMIT_NOTE =
  ' CHỈ thực hiện phần việc trong task ở trên; các phần khác của yêu cầu gốc là việc của CÁC BƯỚC KHÁC trong kế hoạch — KHÔNG làm thay, KHÔNG gọi tool cho phần đó.';
export const PRIOR_ROUNDS_CONTEXT_HEADER =
  'Dữ liệu THẬT đã thu thập được từ (các) bước trước trong CÙNG yêu cầu này (PHẢI dùng ĐÚNG NGUYÊN VĂN, không tự bịa/diễn giải lại số liệu):';
