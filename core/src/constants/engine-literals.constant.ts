// Literal dùng chung ở nhiều nơi trong lớp engine — định nghĩa một lần để đổi ở
// một chỗ và tránh lệch chính tả giữa các bản sao.

// Provider và tool ghi SQL: Risk Gate, executor và tóm tắt phê duyệt cùng nhận diện.
export const SQL_SERVER_PROVIDER = 'sql_server';
export const EXECUTE_WRITE_QUERY_TOOL = 'execute_write_query';

// Câu trả lời mặc định khi model/supervisor không trả nội dung nào.
export const DEFAULT_EMPTY_ANSWER = 'Xin lỗi, mình chưa có câu trả lời phù hợp.';

// Kết quả của một bước kế hoạch mà agent đích chưa khả dụng (chưa kết nối/chưa có hạ tầng).
export const AGENT_UNAVAILABLE_RESULT =
  'Agent này chưa khả dụng (chưa kết nối hoặc chưa có hạ tầng) — bỏ qua, không thực hiện được phần việc này.';

// Id của pipeline mặc định (2 bước): pipeline engine tự đăng ký và workflow registry tham chiếu.
export const DEFAULT_TWO_STEP_PIPELINE_ID = 'default-two-step-pipeline';
