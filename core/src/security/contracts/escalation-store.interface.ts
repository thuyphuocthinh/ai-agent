import { EEscalationStatus } from '../constants/security.constants';
import { EscalationTicket } from '../security.interface';

/**
 * Cổng giao tiếp lưu trữ vé bàn giao người thật (Escalation Store Port).
 * Trừu tượng hóa nơi lưu trữ: RAM, TypeORM, CRM Ticketing System (Zendesk / Jira).
 */
export interface IEscalationTicketStore {
  /**
   * Lưu vé hỗ trợ mới.
   */
  save(ticket: EscalationTicket): Promise<void>;

  /**
   * Tìm vé theo ticketId.
   */
  findById(ticketId: string): Promise<EscalationTicket | null>;

  /**
   * Tìm danh sách vé theo phiên hội thoại.
   */
  findByConversationId(conversationId: string): Promise<EscalationTicket[]>;

  /**
   * Cập nhật trạng thái vé.
   */
  updateStatus(
    ticketId: string,
    status: EEscalationStatus,
  ): Promise<EscalationTicket | null>;
}
