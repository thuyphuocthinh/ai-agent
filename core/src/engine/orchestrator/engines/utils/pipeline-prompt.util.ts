import {
  SCHEMA_CORRECTION_INSTRUCTION,
  SCHEMA_CORRECTION_INTRO,
  SCHEMA_CORRECTION_ORIGINAL_LABEL,
} from '../../../../constants/prompts';

// Prompt 1-shot self-healing: đưa lại chi tiết lỗi schema (đã JSON.stringify ở nơi gọi) và
// output ban đầu để model sửa thành JSON hợp lệ.
export function buildSchemaCorrectionPrompt(
  errorDetailJson: string,
  originalOutput: string,
): string {
  return [
    SCHEMA_CORRECTION_INTRO,
    `Chi tiết lỗi: ${errorDetailJson}`,
    SCHEMA_CORRECTION_ORIGINAL_LABEL,
    originalOutput,
    SCHEMA_CORRECTION_INSTRUCTION,
  ].join('\n\n');
}

export function buildFanoutAggregatorPrompt(
  prompt: string,
  resultsSummary: string,
): string {
  return [
    `YÊU CẦU NGƯỜI DÙNG: "${prompt}"`,
    'DỮ LIỆU TỪ CÁC NGUỒN ĐỘC LẬP:',
    resultsSummary,
    'Hãy tổng hợp, so sánh và đưa ra câu trả lời cuối cùng đầy đủ, khách quan nhất:',
  ].join('\n\n');
}
