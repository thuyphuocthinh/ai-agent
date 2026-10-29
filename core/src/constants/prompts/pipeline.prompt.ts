// Văn bản tĩnh của Pipeline Chaining: prompt tự sửa JSON và pipeline mặc định 2 bước. Chuỗi
// có nội suy nằm ở engine/orchestrator/engines/utils/pipeline-prompt.util.ts.

// 1-shot self-healing khi output của một bước không khớp schema bắt buộc.
export const SCHEMA_CORRECTION_INTRO =
  'Dữ liệu JSON bạn vừa tạo ra không đúng định dạng schema bắt buộc.';
export const SCHEMA_CORRECTION_ORIGINAL_LABEL = 'Dữ liệu ban đầu của bạn:';
export const SCHEMA_CORRECTION_INSTRUCTION =
  'YÊU CẦU: Hãy sửa lại và trả về DUY NHẤT một chuỗi JSON hợp lệ tuân thủ đúng schema trên. Không giải thích thêm.';

// Pipeline mặc định: bóc tách dữ liệu thô (model rẻ) rồi phân tích và tổng hợp (model mạnh).
// `{{input}}` là placeholder của pipeline, được thay bằng output của bước trước.
export const DEFAULT_PIPELINE_DESCRIPTION =
  'Quy trình chuẩn 2 bước: Bóc tách dữ liệu thô (Model rẻ) -> Phân tích & Tổng hợp (Model xịn)';

export const EXTRACT_STEP_SYSTEM_PROMPT =
  'Bạn là chuyên viên trích xuất dữ liệu. Hãy bóc tách các ý chính, thông số số liệu và thông tin cấu trúc từ yêu cầu của người dùng một cách chính xác, ngắn gọn.';
export const EXTRACT_STEP_PROMPT_TEMPLATE =
  'Dữ liệu đầu vào từ người dùng:\n{{input}}\n\nHãy trích xuất đầy đủ các thông tin cốt lõi.';

export const SYNTHESIZE_STEP_SYSTEM_PROMPT =
  'Bạn là chuyên gia cố vấn cao cấp. Dựa trên dữ liệu đã được trích xuất, hãy đưa ra câu trả lời toàn diện, sâu sắc và các khuyến nghị tối ưu nhất.';
export const SYNTHESIZE_STEP_PROMPT_TEMPLATE =
  'Dữ liệu đã được bóc tách từ bước trước:\n{{input}}\n\nHãy tổng hợp thành câu trả lời hoàn chỉnh, mạch lạc và chuyên nghiệp.';
