import {
  MAX_STEPS_FALLBACK_ANSWER,
  NO_OTHER_TOOLS_SUGGESTION,
  PARTIAL_WRITE_CAVEAT,
  POLICY_ENFORCEMENT_HEADING,
  POLICY_ENFORCEMENT_TEXT,
  POLICY_GROUNDING_INTRO,
  POLICY_GROUNDING_TITLE,
  RESOURCES_PROMPT_HEADER,
  RECALLED_MEMORIES_HEADER,
  RECALLED_MEMORIES_FOOTER,
  TOOL_ERROR_RECOVERY_PREFIX,
  TOOL_ERROR_SELF_HEAL_HINT,
  TOOL_ERROR_FAIL_FAST_PREFIX,
} from '../../../constants/prompts';

export interface PolicyExcerpt {
  id: string;
  title: string;
  content: string;
}

// Một resource MCP (đã cắt theo ngân sách) dưới dạng khối có tiêu đề.
export function formatResourceBlock(name: string, content: string): string {
  return `\n--- Resource: ${name} ---\n${content}`;
}

// Phần nối vào system instruction cho các resource; '' khi không có resource nào
// (khối rỗng do đọc lỗi bị bỏ qua).
export function buildResourcesPrompt(resourceBlocks: readonly string[]): string {
  const injected = resourceBlocks.filter(Boolean).join('\n');
  return injected ? `\n\n${RESOURCES_PROMPT_HEADER}\n${injected}` : '';
}

// Phần nối vào system instruction cho các quy chế liên quan; '' khi không có quy chế.
export function buildPolicyGroundingPrompt(
  policies: readonly PolicyExcerpt[],
): string {
  if (policies.length === 0) return '';

  const policiesText = policies
    .map((p) => `- [${p.id}] ${p.title}:\n  ${p.content}`)
    .join('\n\n');

  return (
    `\n\n${POLICY_GROUNDING_TITLE}\n` +
    `${POLICY_GROUNDING_INTRO}\n\n${policiesText}\n\n` +
    `${POLICY_ENFORCEMENT_HEADING}\n` +
    POLICY_ENFORCEMENT_TEXT
  );
}

// Nhắc model làm tiếp khi số bản ghi theo kết quả tool chưa đủ số yêu cầu.
export function buildQuantityNudgePrompt(
  requiredCount: number,
  achievedCount: number,
): string {
  return `Yêu cầu cần xử lý đúng ${requiredCount} bản ghi, nhưng theo kết quả tool hiện tại mới có ${achievedCount}. Hãy tiếp tục thực hiện phần còn thiếu trước khi trả lời.`;
}

// Câu trả lời cuối khi vẫn thiếu số lượng: luôn chèn CON SỐ THẬT đã tính được,
// không tin nguyên văn câu trả lời của model.
export function buildQuantityMismatchAnswer(
  baseAnswer: string,
  requiredCount: number,
  achievedCount: number,
): string {
  return `${baseAnswer}\n\n⚠️ Yêu cầu cần xử lý đúng ${requiredCount}, nhưng theo kết quả tool THẬT chỉ xác nhận được ${achievedCount}.`;
}

// Chi tiết hiển thị khi một thao tác vượt hạn mức AI và phải leo thang lên người duyệt.
export function buildEscalationDetail(
  displayName: string,
  currentAmount: number | undefined,
  thresholdLimit: number | undefined,
): string {
  return `Thao tác ${displayName} yêu cầu số tiền ${currentAmount ?? 'N/A'} vượt hạn mức AI (${thresholdLimit ?? 'N/A'})`;
}

// Kết quả trả cho model khi thao tác đang/đã được xử lý (khóa idempotency).
export function buildIdempotencyBlockedMessage(reason: string | undefined): string {
  return `[Idempotency] Thao tác đang được xử lý hoặc đã hoàn tất trước đó (${reason}).`;
}

// Kết quả trả cho model khi bị chặn vì gọi lại cùng một tool với đúng tham số quá nhiều lần.
export function buildRepeatedToolCallMessage(
  displayName: string,
  attempts: number,
  otherToolNames: readonly string[],
): string {
  const suggestion =
    otherToolNames.length > 0
      ? `KHÔNG được gọi lại tool này. Nếu nhiệm vụ cần 1 HÀNH ĐỘNG (ghi/thêm/tạo/sửa dữ liệu...), hãy gọi tool phù hợp trong số các tool còn lại: ${otherToolNames.join(', ')}.`
      : NO_OTHER_TOOLS_SUGGESTION;
  return `Tool "${displayName}" đã được gọi với ĐÚNG tham số này ${attempts - 1} lần trước đó và không thực thi lại nữa. ${suggestion} Nếu không có tool nào phù hợp để hoàn thành yêu cầu, báo thẳng cho người dùng biết giới hạn đó thay vì im lặng bỏ cuộc.`;
}

// Kết quả báo cho các tool call INSERT đã được gộp vào 1 batch SQL của call chính.
export function buildMergedSqlBatchResult(primaryCallRef: string | number): string {
  return `Merged into the SQL batch represented by tool call ${primaryCallRef}; no separate database execution and no additional rows were affected.`;
}

// Nhắc model viết nốt các dòng INSERT còn thiếu so với số lượng yêu cầu.
export function buildInsertShortfallMessage(
  recordedCount: number,
  requiredCount: number,
): string {
  return `Đã ghi nhận ${recordedCount}/${requiredCount} dòng yêu cầu (cộng dồn qua các lần gọi trước nếu có). Viết tiếp các dòng CÒN THIẾU (không lặp lại dòng đã gửi) trong 1 câu ghi duy nhất, rồi gọi lại.`;
}

// Câu trả lời khi hết số bước ReAct tối đa; thêm cảnh báo nếu đã có tool chạy thành công.
export function buildMaxStepsAnswer(
  partialText: string,
  hasSuccessfulToolCall: boolean,
): string {
  return (
    (partialText || MAX_STEPS_FALLBACK_ANSWER) +
    (hasSuccessfulToolCall ? PARTIAL_WRITE_CAVEAT : '')
  );
}

// Định dạng khối ký ức dài hạn tiêm vào ReAct system instruction.
export function buildRecalledMemoriesPrompt(memories: readonly string[]): string {
  if (memories.length === 0) return '';
  const lines = memories.map((m) => `- ${m}`).join('\n');
  return `\n\n${RECALLED_MEMORIES_HEADER}\n${lines}\n${RECALLED_MEMORIES_FOOTER}`;
}

// Định dạng thông báo lỗi tool kèm gợi ý tự sửa lỗi (Recovery Hint) hoặc lệnh Fail-Fast dừng khẩn cấp.
export function buildToolExecutionErrorMessage(
  rawErrorMessage: string,
  displayName: string,
  isFailFast: boolean,
  failures: number,
): string {
  if (isFailFast) {
    return (
      `${TOOL_ERROR_RECOVERY_PREFIX} ${rawErrorMessage}\n` +
      `${TOOL_ERROR_FAIL_FAST_PREFIX} Đã thử lại ${failures} lần liên tiếp nhưng công cụ "${displayName}" vẫn thất bại. DỪNG gọi công cụ này ngay lập tức. ` +
      `Hãy giải thích rõ nguyên nhân lỗi và thông báo trực tiếp cho người dùng thay vì tiếp tục thử lại.`
    );
  }
  return (
    `${TOOL_ERROR_RECOVERY_PREFIX} ${rawErrorMessage}\n` +
    `${TOOL_ERROR_SELF_HEAL_HINT}`
  );
}

