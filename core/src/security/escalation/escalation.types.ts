/**
 * Mô hình định danh tài nguyên tổng quát (Domain-Agnostic Resource Reference).
 * Thay thế việc hardcode các thực thể chuyên biệt (orderId, amount) trong Core.
 */
export interface TargetResourceRef {
  /**
   * Miền nghiệp vụ của tài nguyên.
   * Ví dụ: "devops" | "finance" | "hr" | "ecommerce" | "support" | "system"
   */
  domain: string;

  /**
   * Loại tài nguyên cụ thể trong miền nghiệp vụ.
   * Ví dụ: "database_table" | "payment" | "employee_record" | "order" | "config"
   */
  type: string;

  /**
   * Khóa định danh duy nhất của tài nguyên.
   * Ví dụ: "orders_table" | "TX-9981" | "EMP-204" | "102"
   */
  id: string;
}

/**
 * Tham số tạo phiếu bàn giao sự vụ con người tổng quát (Human Escalation Request).
 */
export interface CreateEscalationParams {
  conversationId: string;
  userId: string;
  reason: string;
  sessionId?: string;
  targetResource?: TargetResourceRef;
  metadata?: Record<string, unknown>;
  handoverSummary?: string;
  recentMessages?: string[];

  // Tương thích ngược với các cuộc gọi nghiệp vụ bán hàng cũ
  orderId?: string;
  requestedAmount?: number;
}
