import { BaseDomainException } from '../../common/errors';

export class EscalationRequiredError extends BaseDomainException {
  public readonly code = 'EXCEEDS_AI_AUTHORITY';
  public readonly statusCode = 403;
  public readonly status = 403;
  public readonly ticketId: string;
  public readonly handoverSummary: string;

  constructor(
    public readonly reason: string,
    ticketId?: string,
    handoverSummary?: string,
    public readonly requestedAmount?: number,
  ) {
    const resolvedTicketId =
      ticketId || `TK-${Date.now().toString(36).toUpperCase()}`;
    const resolvedSummary =
      handoverSummary || `Chuyển tiếp yêu cầu: ${reason}`;

    super(
      `Yêu cầu vượt quá thẩm quyền của AI, đã chuyển tiếp cho nhân viên thật (Ticket #${resolvedTicketId}): ${reason}`,
      {
        userFriendlyMessage: `Yêu cầu cần được nhân viên hỗ trợ trực tiếp. Mã phiếu hỗ trợ của bạn là #${resolvedTicketId}.`,
        details: {
          ticketId: resolvedTicketId,
          reason,
          handoverSummary: resolvedSummary,
          ...(requestedAmount !== undefined ? { requestedAmount } : {}),
        },
      },
    );

    this.ticketId = resolvedTicketId;
    this.handoverSummary = resolvedSummary;
  }
}
