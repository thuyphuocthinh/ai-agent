import { Injectable } from '@nestjs/common';
import { IEscalationTicketStore } from '../contracts/escalation-store.interface';
import { EscalationTicket } from '../security.interface';
import { EEscalationStatus } from '../constants/security.constants';

@Injectable()
export class InMemoryEscalationStore implements IEscalationTicketStore {
  private readonly tickets = new Map<string, EscalationTicket>();

  async save(ticket: EscalationTicket): Promise<void> {
    this.tickets.set(ticket.ticketId, ticket);
  }

  async findById(ticketId: string): Promise<EscalationTicket | null> {
    return this.tickets.get(ticketId) ?? null;
  }

  async findByConversationId(
    conversationId: string,
  ): Promise<EscalationTicket[]> {
    return Array.from(this.tickets.values()).filter(
      (t) => t.conversationId === conversationId,
    );
  }

  async updateStatus(
    ticketId: string,
    status: EEscalationStatus,
  ): Promise<EscalationTicket | null> {
    const ticket = this.tickets.get(ticketId);
    if (!ticket) return null;
    ticket.status = status;
    return ticket;
  }
}
