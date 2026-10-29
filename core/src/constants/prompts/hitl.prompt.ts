// Văn bản tĩnh của luồng HITL (duyệt/làm rõ/dọn dẹp). Chuỗi có nội suy nằm ở
// engine/hitl/utils/hitl-message.util.ts.

// Thông báo khi worker sập SAU khi hành động đã được duyệt (checkpoint-cleanup).
// toolExecutedAt đã set: hành động THẬT đã chạy xong, worker chỉ crash lúc tổng hợp.
export const WORKER_CRASHED_AFTER_EXECUTION_MESSAGE =
  '⚠️ Hành động đã được duyệt và THỰC THI THÀNH CÔNG, nhưng worker gặp sự cố ngay sau đó khi tổng hợp câu trả lời. Kết quả đã được ghi — không cần thực hiện lại hành động này.';
// toolExecutedAt chưa set KHÔNG có nghĩa là chưa chạy: báo "thử lại" chắc nịch có thể làm
// hành động không idempotent chạy trùng, nên chỉ yêu cầu người dùng tự kiểm tra.
export const WORKER_CRASHED_EXECUTION_UNKNOWN_MESSAGE =
  '⚠️ Hành động đã được duyệt nhưng worker gặp sự cố trong lúc thực thi — CHƯA THỂ XÁC ĐỊNH hành động đã thực sự chạy hay chưa. Vui lòng tự kiểm tra kết quả (VD trong hệ thống/ứng dụng đích) TRƯỚC KHI yêu cầu lại, để tránh thực hiện trùng.';

// Marker nối vào task của bước "làm tiếp phần còn thiếu" (số lượng chưa đủ); phần trước marker
// là task gốc — dùng để đếm số lần đã thử cùng một task.
export const CONTINUATION_TASK_MARKER = '\n\n(Đã xử lý';
