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

// Provider đặc biệt của McpToolConnectorService: trả các native tool dùng chung cho mọi agent (VD read_skill).
export const NATIVE_TOOL_PROVIDER = 'native';

// Conversation Artifact Handoff literals (tách biệt hoàn toàn khỏi /tmp/artifacts của Python Sandbox)
export const CONV_ARTIFACT_DIR_NAME = 'agent-conv-artifacts';
export const CONV_ARTIFACT_STATUS = 'saved_to_artifact' as const;
export const CONV_ARTIFACT_FILE_PREFIX = 'artifact_';
export const CONV_ARTIFACT_READ_TOOL_NAME = 'read_conversation_artifact';
export const CONV_ARTIFACT_OFFLOAD_NOTE =
  'Dữ liệu lớn đã lưu vào kho artifact của cuộc trò chuyện (hết hạn sau 4h). Gọi read_conversation_artifact với filename khi bước sau cần đọc lại.';

export const CONV_ARTIFACT_FORMAT = {
  JSON: { extension: '.json', mimeType: 'application/json' },
  TEXT: { extension: '.txt', mimeType: 'text/plain' },
} as const;

export const CONV_ARTIFACT_ERROR_CODES = {
  INVALID_ARGUMENTS: 'INVALID_ARGUMENTS',
  MISSING_CONVERSATION: 'MISSING_CONVERSATION',
  NOT_FOUND: 'ARTIFACT_NOT_FOUND',
  READ_FAILED: 'ARTIFACT_READ_FAILED',
} as const;
