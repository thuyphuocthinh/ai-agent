import { buildSchemaCorrectionPrompt } from './pipeline-prompt.util';
import {
  DEFAULT_PIPELINE_DESCRIPTION,
  EXTRACT_STEP_PROMPT_TEMPLATE,
  EXTRACT_STEP_SYSTEM_PROMPT,
  SYNTHESIZE_STEP_PROMPT_TEMPLATE,
  SYNTHESIZE_STEP_SYSTEM_PROMPT,
} from '../../../../constants/prompts';

// Chuỗi mong đợi được copy NGUYÊN VĂN từ pipeline-chaining.engine.ts trước khi chuyển.
describe('pipeline prompts (golden)', () => {
  it('builds the 1-shot self-healing correction prompt', () => {
    expect(buildSchemaCorrectionPrompt('[{"path":["a"]}]', '{"a":')).toBe(
      'Dữ liệu JSON bạn vừa tạo ra không đúng định dạng schema bắt buộc.\n\n' +
        'Chi tiết lỗi: [{"path":["a"]}]\n\n' +
        'Dữ liệu ban đầu của bạn:\n\n' +
        '{"a":\n\n' +
        'YÊU CẦU: Hãy sửa lại và trả về DUY NHẤT một chuỗi JSON hợp lệ tuân thủ đúng schema trên. Không giải thích thêm.',
    );
  });

  it('keeps the default two-step pipeline texts unchanged', () => {
    expect(DEFAULT_PIPELINE_DESCRIPTION).toBe(
      'Quy trình chuẩn 2 bước: Bóc tách dữ liệu thô (Model rẻ) -> Phân tích & Tổng hợp (Model xịn)',
    );
    expect(EXTRACT_STEP_SYSTEM_PROMPT).toBe(
      'Bạn là chuyên viên trích xuất dữ liệu. Hãy bóc tách các ý chính, thông số số liệu và thông tin cấu trúc từ yêu cầu của người dùng một cách chính xác, ngắn gọn.',
    );
    expect(EXTRACT_STEP_PROMPT_TEMPLATE).toBe(
      'Dữ liệu đầu vào từ người dùng:\n{{input}}\n\nHãy trích xuất đầy đủ các thông tin cốt lõi.',
    );
    expect(SYNTHESIZE_STEP_SYSTEM_PROMPT).toBe(
      'Bạn là chuyên gia cố vấn cao cấp. Dựa trên dữ liệu đã được trích xuất, hãy đưa ra câu trả lời toàn diện, sâu sắc và các khuyến nghị tối ưu nhất.',
    );
    expect(SYNTHESIZE_STEP_PROMPT_TEMPLATE).toBe(
      'Dữ liệu đã được bóc tách từ bước trước:\n{{input}}\n\nHãy tổng hợp thành câu trả lời hoàn chỉnh, mạch lạc và chuyên nghiệp.',
    );
  });

  it('keeps the {{input}} placeholder in both step templates', () => {
    expect(EXTRACT_STEP_PROMPT_TEMPLATE).toContain('{{input}}');
    expect(SYNTHESIZE_STEP_PROMPT_TEMPLATE).toContain('{{input}}');
  });
});

