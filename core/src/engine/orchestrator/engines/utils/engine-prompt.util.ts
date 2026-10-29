// Thông báo dùng chung của các execution engine (single agent, pipeline, dynamic supervisor).

// Số ký tự tối đa của kết quả tool đưa vào prompt tiếp tục sau khi duyệt.
const FOLLOW_UP_RESULT_MAX_CHARS = 1500;

// Prompt của lượt chạy lại sau khi người dùng chọn ứng viên ở bước làm rõ.
export function buildClarifiedPrompt(
  originalPrompt: string,
  candidateLabel: string,
  candidateId: string | null | undefined,
): string {
  return `${originalPrompt}\n\n[Khách hàng được chọn: ${candidateLabel} (Mã: ${candidateId})]`;
}

// Prompt của lượt chạy tiếp sau khi một hành động rủi ro đã được duyệt và thực thi thành công:
// báo tiến độ, cấm gọi lại hành động đó và dặn làm nốt các bước còn lại.
export function buildApprovalFollowUpPrompt(input: {
  originalPrompt: string;
  provider: string;
  toolName: string;
  resultText: string;
}): string {
  const { originalPrompt, provider, toolName, resultText } = input;
  return [
    '[BỐI CẢNH TIẾN ĐỘ THỰC THI]:',
    `- Yêu cầu gốc: "${originalPrompt}"`,
    `- Hành động rủi ro "${provider}.${toolName}" ĐÃ ĐƯỢC NGƯỜI DÙNG PHÊ DUYỆT VÀ ĐÃ THỰC THI THÀNH CÔNG trên hệ thống.`,
    `- Kết quả thực thi thực tế: ${resultText.slice(0, FOLLOW_UP_RESULT_MAX_CHARS)}`,
    '',
    '[CHỈ DẪN TIẾP TỤC]:',
    `1. TUYỆT ĐỐI KHÔNG gọi lại hành động "${toolName}" hoặc các bước đã hoàn tất trước đó (dữ liệu đã được ghi nhận trên hệ thống).`,
    '2. Nếu trong yêu cầu ban đầu CÒN BƯỚC TIẾP THEO (ví dụ: gửi thông báo Slack/Email, tổng hợp thêm...), hãy tiếp tục sử dụng công cụ phù hợp để hoàn tất.',
    '3. Nếu TẤT CẢ CÁC BƯỚC ĐÃ XONG, hãy viết câu trả lời hoàn chỉnh để báo cáo kết quả cho người dùng.',
  ].join('\n');
}

// Câu trả lời khi 100% worker của Fan-out thất bại (không gọi Aggregator).
export function buildFanoutAllFailedAnswer(
  workerResults: readonly { workerName: string; error?: string }[],
): string {
  const failureSummary = workerResults
    .map((r) => `- ${r.workerName}: ${r.error ?? 'Lỗi không xác định'}`)
    .join('\n');
  return `⚠️ Không thể tổng hợp dữ liệu (không thể cung cấp kết quả) do toàn bộ nguồn worker đều gặp sự cố:\n${failureSummary}`;
}

// Kết quả của Aggregator khi không có worker nào thành công.
export function buildAggregatorNoSuccessMessage(totalWorkers: number): string {
  return `Tất cả ${totalWorkers} nguồn dữ liệu đều gặp lỗi và không thể cung cấp kết quả. Vui lòng thử lại sau.`;
}

// Prompt cô lập của sub-agent: dữ liệu do agent chính cung cấp (nếu có) rồi nhiệm vụ.
export function buildIsolatedSubAgentPrompt(
  context: string | undefined,
  task: string,
): string {
  return context
    ? `=== DỮ LIỆU CUNG CẤP TỪ AGENT CHÍNH ===\n${context}\n\n=== NHIỆM VỤ CẦN THỰC HIỆN ===\n${task}`
    : task;
}

export function buildSubAgentFailureResult(errorMessage: string | undefined): string {
  return `Sub-agent không thể hoàn thành nhiệm vụ do lỗi: ${errorMessage}`;
}

// Thông báo khi tool đã được người dùng duyệt nhưng thực thi thất bại lúc resume.
export function buildApprovedToolFailureMessage(
  toolName: string,
  resultText: string,
): string {
  return `⚠️ Hành động "${toolName}" đã được duyệt nhưng thực thi thất bại:\n${resultText}`;
}
