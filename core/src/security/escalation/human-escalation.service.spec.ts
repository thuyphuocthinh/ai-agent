import { HumanEscalationService } from './human-escalation.service';
import { InMemoryEscalationStore } from '../adapters/in-memory-escalation.store';
import { EConversationState } from '../../contracts/session/chat-session.interface';
import { EEscalationStatus } from '../constants/security.constants';

describe('HumanEscalationService', () => {
  let service: HumanEscalationService;
  let mockSessionManager: { setConversationState: jest.Mock };
  let store: InMemoryEscalationStore;

  beforeEach(() => {
    store = new InMemoryEscalationStore();
    mockSessionManager = {
      setConversationState: jest.fn(),
    };
    service = new HumanEscalationService(store, mockSessionManager as any);
  });

  it('creates an escalation ticket and triggers HUMAN_TAKEOVER on session', async () => {
    const ticket = await service.createTicket({
      conversationId: 'conv-101',
      userId: 'u1',
      reason: 'Yêu cầu hoàn tiền vượt hạn mức AI',
      sessionId: 'sess-101',
      orderId: '102',
      requestedAmount: 3_000_000,
    });

    expect(ticket.ticketId).toMatch(/^TK-/);
    expect(ticket.status).toBe(EEscalationStatus.OPEN);
    expect(ticket.handoverSummary).toContain('#102');
    expect(ticket.handoverSummary).toContain('3.000.000 VNĐ');

    expect(mockSessionManager.setConversationState).toHaveBeenCalledWith(
      'sess-101',
      EConversationState.HUMAN_TAKEOVER,
    );

    const retrieved = await service.getTicket(ticket.ticketId);
    expect(retrieved?.ticketId).toBe(ticket.ticketId);
  });

  it('creates an escalation ticket with generic target resource for non-ecommerce domains', async () => {
    const ticket = await service.createTicket({
      conversationId: 'conv-devops',
      userId: 'dev-01',
      reason: 'Yêu cầu khôi phục bảng dữ liệu bị hỏng',
      sessionId: 'sess-devops',
      targetResource: {
        domain: 'devops',
        type: 'database_table',
        id: 'production_orders',
      },
      metadata: { severity: 'CRITICAL', env: 'production' },
    });

    expect(ticket.targetResource).toEqual({
      domain: 'devops',
      type: 'database_table',
      id: 'production_orders',
    });
    expect(ticket.handoverSummary).toContain(
      '[devops/database_table] #production_orders',
    );
    expect(ticket.metadata).toEqual({ severity: 'CRITICAL', env: 'production' });
  });

  it('resolves an escalation ticket and optionally reactivates AI', async () => {
    const ticket = await service.createTicket({
      conversationId: 'conv-102',
      userId: 'u2',
      reason: 'Vấn đề giao hàng',
      sessionId: 'sess-102',
    });

    const resolved = await service.resolveTicket(ticket.ticketId, 'sess-102', true);

    expect(resolved?.status).toBe(EEscalationStatus.RESOLVED);
    expect(mockSessionManager.setConversationState).toHaveBeenCalledWith(
      'sess-102',
      EConversationState.AI_ACTIVE,
    );
  });
});
