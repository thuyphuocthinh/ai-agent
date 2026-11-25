export const TOOL_REFLECTION_HEADER = '--- [HỆ THỐNG PHẢN XẠ & CHẨN ĐOÁN LỖI CÔNG CỤ] ---';
export const TOOL_REFLECTION_DIAGNOSIS_PREFIX = '1. Chẩn đoán nguyên nhân:';
export const TOOL_REFLECTION_GUIDANCE_PREFIX = '2. Chỉ dẫn tự sửa (Actionable Guidance):';
export const TOOL_REFLECTION_REPEAT_WARNING =
  '3. CẢNH BÁO: KHÔNG được gọi lại công cụ này với bộ tham số y hệt (sẽ bị ToolRepeatGuard chặn).';
export const TOOL_REFLECTION_FOOTER = '---------------------------------------------------';

export const TOOL_FAIL_FAST_TITLE = '[FAIL-FAST - NGỪNG THỬ LẠI]';
export const TOOL_FAIL_FAST_MANDATORY_ACTION =
  'Hành động bắt buộc: Không tiếp tục gọi lại công cụ này nữa. Hãy thông báo ngay cho người dùng về sự cố.';

// Chuỗi chẩn đoán cho từng chiến lược (Strategy)
export const STRATEGY_MISSING_ARG_MSG = 'Thiếu tham số bắt buộc trong lời gọi công cụ.';
export const STRATEGY_MISSING_ARG_HINT = 'Hãy bổ sung đầy đủ các trường bắt buộc vào tham số trước khi thử lại.';

export const STRATEGY_TYPE_MISMATCH_MSG = 'Sai kiểu dữ liệu của tham số.';
export const STRATEGY_TYPE_MISMATCH_HINT = 'Hãy kiểm tra lại schema kiểu dữ liệu (số, chuỗi, mảng) và chuyển đổi chính xác.';

export const STRATEGY_NOT_FOUND_MSG = 'Tài nguyên mục tiêu không tồn tại.';
export const STRATEGY_NOT_FOUND_HINT = 'Hãy dùng công cụ tìm kiếm hoặc liệt kê trước để lấy đúng mã định danh (ID/Code).';

export const STRATEGY_QUERY_SYNTAX_MSG = 'Lỗi cú pháp truy vấn (SQL/Filter).';
export const STRATEGY_QUERY_SYNTAX_HINT = 'Hãy rà soát lại tên bảng, tên cột và cú pháp câu lệnh truy vấn.';

export const STRATEGY_AUTH_PERMISSION_MSG = 'Lỗi xác thực hoặc không đủ quyền truy cập.';
export const STRATEGY_AUTH_PERMISSION_HINT = 'Công cụ này bị từ chối truy cập. Chuyển sang phương án dự phòng hoặc báo cáo người dùng.';

export const STRATEGY_GENERIC_MSG = 'Thực thi công cụ thất bại.';
export const STRATEGY_GENERIC_HINT = 'Hãy đọc kỹ chi tiết lỗi bên trên, điều chỉnh tham số phù hợp hoặc chọn công cụ thay thế.';

// Chuỗi Critic Feedback
export const CRITIC_FEEDBACK_HEADING = '[CRITIC PHÊ BÌNH TỰ KIỂM TRA (FACT-GROUNDING)]:';
export const CRITIC_UNGROUNDED_METRIC_WARNING =
  '- CẢNH BÁO ẢO GIÁC SỐ LIỆU: Các số liệu sau không xuất hiện trong kết quả của các công cụ đã chạy:';
export const CRITIC_UNGROUNDED_METRIC_ACTION =
  '  YÊU CẦU: Hãy loại bỏ những con số tự tính toán/bịa đặt này, hoặc gọi thêm công cụ để lấy dữ liệu thực tế.';
export const CRITIC_MISSED_CLAUSE_WARNING =
  '- THIẾU NỘI DUNG: Câu hỏi của người dùng có nhiều vế, nhưng phản hồi hiện tại quá ngắn. Hãy trả lời trọn vẹn từng vế.';
