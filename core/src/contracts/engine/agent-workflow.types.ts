import { WorkflowSummaryDto } from '../dtos/workflow.dto';

export const WORKFLOW_REGISTRY = Symbol.for('WORKFLOW_REGISTRY');
export const WORKFLOW_RUNNER = Symbol.for('WORKFLOW_RUNNER');

/**
 * Cấu hình khởi tạo một Fixed Workflow (Deterministic Agent).
 */
export interface AgentWorkflowConfig {
  /**
   * Mã định danh duy nhất của workflow (kebab-case, ví dụ: 'hotel-booking').
   */
  readonly id: string;

  /**
   * Tên hiển thị người dùng (ví dụ: 'Hotel Booking Assistant').
   */
  readonly name: string;

  /**
   * Mô tả nghiệp vụ tóm tắt.
   */
  readonly description?: string;

  /**
   * Chỉ thị hệ thống (System Prompt) định hướng hành vi chuyên biệt cho workflow.
   */
  readonly systemPrompt: string;

  /**
   * Danh sách tên công cụ (tool names) được phép thực thi trong workflow này.
   * Nếu để trống hoặc không truyền, workflow chỉ phản hồi đàm thoại thuần túy.
   * Nếu truyền ['*'], workflow được truy cập toàn bộ công cụ khả dụng.
   */
  readonly tools?: readonly string[];

  /**
   * Số vòng lặp ReAct tối đa trước khi tự động dừng (mặc định theo ORCHESTRATION_CONSTANTS.MAX_REACT_LOOPS).
   */
  readonly maxLoops?: number;

  /**
   * Tên mô hình LLM chuyên biệt nếu muốn ghi đè mô hình mặc định của hệ thống.
   */
  readonly model?: string;

  /**
   * Độ biến thiên sinh từ (0.0 - 1.0).
   */
  readonly temperature?: number;

  /**
   * Danh sách công cụ bắt buộc phải tạm dừng chờ Human-In-The-Loop (HITL) phê duyệt.
   */
  readonly requireHumanApprovalFor?: readonly string[];

  /**
   * Danh sách quyền / scopes bảo mật cần thiết để gọi workflow này.
   */
  readonly securityScopes?: readonly string[];

  /**
   * Tên provider kết nối công cụ mặc định (mặc định 'compute' hoặc agent tương ứng).
   */
  readonly provider?: string;
}

/**
 * Interface trừu tượng quản lý danh mục Workflow trong runtime (DIP Port).
 */
export interface IWorkflowRegistry {
  register(workflow: AgentWorkflowConfig): void;
  get(id: string): AgentWorkflowConfig | undefined;
  list(): WorkflowSummaryDto[];
  has(id: string): boolean;
}

/**
 * SDK Helper tạo và đóng băng cấu hình Agent Workflow.
 * Đảm bảo dữ liệu đầu vào hợp lệ và ngăn ngừa đột biến (immutable).
 */
export function createWorkflow(
  config: AgentWorkflowConfig,
): Readonly<AgentWorkflowConfig> {
  if (!config.id || typeof config.id !== 'string' || !config.id.trim()) {
    throw new Error('Workflow id is required and must be a non-empty string');
  }

  if (!config.name || typeof config.name !== 'string' || !config.name.trim()) {
    throw new Error('Workflow name is required and must be a non-empty string');
  }

  if (
    !config.systemPrompt ||
    typeof config.systemPrompt !== 'string' ||
    !config.systemPrompt.trim()
  ) {
    throw new Error(
      'Workflow systemPrompt is required and must be a non-empty string',
    );
  }

  return Object.freeze({
    ...config,
    id: config.id.trim(),
    name: config.name.trim(),
    systemPrompt: config.systemPrompt.trim(),
    tools: config.tools ? Object.freeze([...config.tools]) : Object.freeze([]),
    requireHumanApprovalFor: config.requireHumanApprovalFor
      ? Object.freeze([...config.requireHumanApprovalFor])
      : Object.freeze([]),
    securityScopes: config.securityScopes
      ? Object.freeze([...config.securityScopes])
      : Object.freeze([]),
    provider: config.provider ? config.provider.trim() : undefined,
  });
}
