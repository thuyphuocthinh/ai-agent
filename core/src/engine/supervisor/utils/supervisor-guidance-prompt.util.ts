import {
  DEFAULT_DENY_REASON,
  DONE_NOT_ALLOWED_NOTE,
  DEFAULT_ESCALATE_REASON,
  DEFAULT_INGRESS_RULE_ID,
  DEFAULT_POLICY_RULE_ID,
  SUPERVISOR_POLICY_TITLE,
  SUPERVISOR_SECURITY_RULES,
  FRUSTRATION_WARNING_HEAD,
  FRUSTRATION_WARNING_TAIL,
  HIDDEN_AI_ANSWER_PLACEHOLDER,
  HISTORY_SECTION_HEADER,
  MEMORIES_SECTION_HEADER,
  NO_AGENT_CONNECTED_TEXT,
  ROUNDS_SECTION_FOOTER,
  ROUNDS_SECTION_HEADER,
  SKILL_CATALOG_SECTION_HEADER,
} from '../../../constants/prompts';
import { ChatHistoryTurnDto } from '../../../contracts/dtos/message-client.dto';
import {
  AvailableAgentDto,
  SupervisorRoundDto,
} from '../../../contracts/dtos/supervisor.dto';

// Các khối ghép thành prompt của Supervisor.plan(): hàm thuần, nhận dữ liệu thuần.

// Mô tả mặc định của hệ thống/API mở rộng (Custom Swagger) khi nó không tự khai báo mô tả.
export function buildDynamicAgentDescription(
  name: string,
  specUrl: string,
): string {
  return `Hệ thống/API mở rộng (Custom Swagger) tên "${name}" — liên quan tới các thao tác/dữ liệu của hệ thống này (tham khảo: ${specUrl}).`;
}

// Câu trả lời trực tiếp của Policy Guard (Supervisor chặn yêu cầu, không phân công agent).
export function buildIngressApprovalRequiredAnswer(citedRuleId?: string): string {
  return `Thao tác cấu hình định tuyến mạng Ingress diện rộng có rủi ro cao và cần có sự phê duyệt từ Quản trị viên (theo quy chế ${citedRuleId || DEFAULT_INGRESS_RULE_ID}). Hệ thống không tự ý áp dụng hoặc hướng dẫn tạo file cấu hình khi chưa có phê duyệt chính thức.`;
}

export function buildPolicyDeniedAnswer(
  reason?: string,
  citedRuleId?: string,
): string {
  return `Từ chối thực thi: ${reason || DEFAULT_DENY_REASON} (Điều khoản: ${citedRuleId || DEFAULT_POLICY_RULE_ID}).`;
}

export function buildPolicyEscalatedAnswer(
  reason?: string,
  citedRuleId?: string,
): string {
  return `Yêu cầu vượt quá thẩm quyền của AI: ${reason || DEFAULT_ESCALATE_REASON} (Điều khoản: ${citedRuleId || DEFAULT_POLICY_RULE_ID}). Sự vụ đã được ghi nhận để nhân sự có thẩm quyền tiếp quản.`;
}

export interface SupervisorPolicyExcerpt {
  id: string;
  title: string;
  content: string;
}

// Phần nối vào system instruction của plan() cho các quy chế liên quan; '' khi không có.
export function buildSupervisorPolicyGuidance(
  policies: readonly SupervisorPolicyExcerpt[],
): string {
  if (policies.length === 0) return '';

  const rules = policies
    .map((p) => `- [${p.id}] ${p.title}: ${p.content}`)
    .join('\n');
  return `\n\n${SUPERVISOR_POLICY_TITLE}\n${rules}\n\n${SUPERVISOR_SECURITY_RULES}`;
}

// Danh sách agent đưa vào system instruction của plan(): mỗi dòng "provider (label): mô tả",
// kèm ghi chú số agent đã ẩn bớt; hoặc thông báo chưa kết nối agent nào.
export function formatAgentList(
  shown: readonly Pick<AvailableAgentDto, 'provider' | 'label' | 'description'>[],
  omittedCount: number,
): string {
  if (shown.length === 0) return NO_AGENT_CONNECTED_TEXT;

  let text = shown
    .map((a) => `- ${a.provider} (${a.label}): ${a.description}`)
    .join('\n');
  if (omittedCount > 0) {
    text += `\n(Còn ${omittedCount} hệ thống khác đã kết nối nhưng không liên quan tới câu hỏi này, đã ẩn bớt khỏi danh sách trên.)`;
  }
  return text;
}

export function buildFrustrationWarning(pattern: string): string {
  return `${FRUSTRATION_WARNING_HEAD}${pattern}${FRUSTRATION_WARNING_TAIL}`;
}

export function buildMemoriesSection(memoryContents: readonly string[]): string {
  const memoryText = memoryContents.map((content) => `- ${content}`).join('\n');
  return `${MEMORIES_SECTION_HEADER}\n<memories>\n${memoryText}\n</memories>`;
}

export function buildSkillCatalogSection(skillCatalog: string): string {
  return `${SKILL_CATALOG_SECTION_HEADER}\n${skillCatalog}`;
}

// Câu trả lời cũ của AI bị thay bằng placeholder: không được dùng lại làm dữ liệu.
export function buildHistorySection(
  history: readonly Pick<ChatHistoryTurnDto, 'role' | 'text'>[],
): string {
  const historyText = history
    .map((h) =>
      h.role === 'model' ? HIDDEN_AI_ANSWER_PLACEHOLDER : `User: ${h.text}`,
    )
    .join('\n');
  return `${HISTORY_SECTION_HEADER}\n${historyText}`;
}

export function buildOriginalPromptSection(originalPrompt: string): string {
  return `Câu hỏi gốc của user: ${originalPrompt}`;
}

// `rounds` đã được cắt theo ngân sách ở nơi gọi.
export function buildRoundsSection(
  rounds: readonly Pick<SupervisorRoundDto, 'agent' | 'task' | 'result'>[],
): string {
  const roundsText = rounds
    .map(
      (r, i) =>
        `${i + 1}. Đã delegate agent "${r.agent}" với yêu cầu "${r.task}" → kết quả: ${r.result}`,
    )
    .join('\n');
  return `${ROUNDS_SECTION_HEADER}\n${roundsText}\n\n${ROUNDS_SECTION_FOOTER}`;
}

// Prompt của evaluate(): đánh giá bước vừa xong và các bước còn lại.
export function buildEvaluatePrompt(params: {
  originalPrompt: string;
  completedAgent: string;
  completedTask: string;
  cappedResult: string;
  remainingText: string;
  mustFinishRemaining: boolean;
}): string {
  const doneNotAllowedNote = params.mustFinishRemaining
    ? DONE_NOT_ALLOWED_NOTE
    : '';
  return `Câu hỏi gốc: ${params.originalPrompt}\n\nBước vừa thực hiện xong — Agent "${params.completedAgent}" (yêu cầu: "${params.completedTask}") → kết quả: ${params.cappedResult}\n\nCác bước CÒN LẠI trong kế hoạch (chưa chạy):\n${params.remainingText}\n\nBước vừa xong có đạt kỳ vọng không, các bước còn lại có còn hợp lý để tiếp tục không?${doneNotAllowedNote}`;
}

// Prompt của synthesize(): `roundsText` là các round đã cắt theo ngân sách, mỗi round một dòng.
export function buildSynthesisPrompt(
  originalPrompt: string,
  roundsText: string,
): string {
  return `Câu hỏi gốc: ${originalPrompt}\n\nDữ liệu đã thu thập được:\n${roundsText}\n\nHãy tổng hợp các dữ liệu trên thành một câu trả lời hoàn chỉnh cho người dùng.`;
}
