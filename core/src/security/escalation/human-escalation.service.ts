import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import type { EscalationTicket } from '../security.interface';
import {
  CHAT_SESSION_MANAGER,
  IChatSessionManager,
  EConversationState,
} from '../../contracts/chat-session.interface';
import {
  EEscalationStatus,
  ESCALATION_STORE,
} from '../constants/security.constants';
import type { IEscalationTicketStore } from '../contracts/escalation-store.interface';
import type { CreateEscalationParams } from './escalation.types';

/**
 * Service quản lý quy trình chuyển giao người thật (Human Escalation)
 * và kích hoạt cờ tắt tiếng AI (AI Mute / HUMAN_TAKEOVER).
 * Phụ thuộc qua IEscalationTicketStore Port (hỗ trợ cắm rút In-Memory / TypeORM / CRM).
 */
@Injectable()
export class HumanEscalationService {
  private readonly logger = new Logger(HumanEscalationService.name);

  constructor(
    @Inject(ESCALATION_STORE)
    private readonly store: IEscalationTicketStore,
    @Optional()
    @Inject(CHAT_SESSION_MANAGER)
    private readonly sessionManager?: IChatSessionManager,
  ) {}

  /**
   * Đóng gói phiếu hỗ trợ (EscalationTicket), tổng hợp tóm tắt bàn giao
   * và kích hoạt trạng thái HUMAN_TAKEOVER cho phiên hội thoại.
   */
  async createTicket(params: CreateEscalationParams): Promise<EscalationTicket> {
    const ticketId = `TK-${Date.now().toString(36).toUpperCase()}-${Math.floor(
      100 + Math.random() * 900,
    )}`;

    const handoverSummary =
      params.handoverSummary || this.synthesizeSummary(params);

    const ticket: EscalationTicket = {
      ticketId,
      conversationId: params.conversationId,
      userId: params.userId,
      targetResource: params.targetResource,
      orderId: params.orderId,
      requestedAmount: params.requestedAmount,
      reason: params.reason,
      handoverSummary,
      createdAt: new Date(),
      status: EEscalationStatus.OPEN,
      metadata: params.metadata,
    };

    await this.store.save(ticket);

    // Kích hoạt cờ tạm ngưng AI trên phiên làm việc
    const targetSessionId = params.sessionId || params.conversationId;
    if (this.sessionManager?.setConversationState && targetSessionId) {
      await this.sessionManager.setConversationState(
        targetSessionId,
        EConversationState.HUMAN_TAKEOVER,
      );
      this.logger.log(
        `Kích hoạt HUMAN_TAKEOVER cho session=${targetSessionId}. Phiếu hỗ trợ #${ticketId}`,
      );
    }

    return ticket;
  }

  /**
   * Nhân viên thật đóng phiếu và kích hoạt lại AI (nếu cần).
   */
  async resolveTicket(
    ticketId: string,
    sessionId?: string,
    reactivateAi = false,
  ): Promise<EscalationTicket | null> {
    const updated = await this.store.updateStatus(
      ticketId,
      EEscalationStatus.RESOLVED,
    );
    if (!updated) return null;

    const targetSessionId = sessionId || updated.conversationId;
    if (this.sessionManager?.setConversationState && targetSessionId) {
      const nextState = reactivateAi
        ? EConversationState.AI_ACTIVE
        : EConversationState.RESOLVED;
      await this.sessionManager.setConversationState(targetSessionId, nextState);
      this.logger.log(
        `Cập nhật trạng thái session=${targetSessionId} thành ${nextState}`,
      );
    }

    return updated;
  }

  /**
   * Lấy chi tiết phiếu hỗ trợ.
   */
  async getTicket(ticketId: string): Promise<EscalationTicket | null> {
    return this.store.findById(ticketId);
  }

  /**
   * Lấy danh sách phiếu của một hội thoại.
   */
  async getTicketsByConversation(
    conversationId: string,
  ): Promise<EscalationTicket[]> {
    return this.store.findByConversationId(conversationId);
  }

  /**
   * Tự động tạo bản tóm tắt bàn giao khi không có bản tóm tắt thủ công.
   */
  private synthesizeSummary(params: CreateEscalationParams): string {
    const parts = [
      `[Yêu cầu chuyển tiếp nhân viên hỗ trợ]`,
      `- Người dùng: ${params.userId}`,
      `- Lý do: ${params.reason}`,
    ];

    if (params.targetResource) {
      parts.push(
        `- Tài nguyên liên quan: [${params.targetResource.domain}/${params.targetResource.type}] #${params.targetResource.id}`,
      );
    } else if (params.orderId) {
      parts.push(`- Đơn hàng liên quan: #${params.orderId}`);
    }

    if (params.requestedAmount) {
      parts.push(
        `- Số tiền yêu cầu: ${params.requestedAmount.toLocaleString('vi-VN')} VNĐ`,
      );
    }

    if (params.recentMessages && params.recentMessages.length > 0) {
      parts.push(`- Lịch sử trao đổi gần nhất:`);
      params.recentMessages.slice(-3).forEach((msg) => parts.push(`  + ${msg}`));
    }

    return parts.join('\n');
  }
}
