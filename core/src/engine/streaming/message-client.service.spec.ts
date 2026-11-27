import { EMessageRole } from '@agent/core/constants';
import { MessageClientService, MessageEvent } from './message-client.service';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe('MessageClientService', () => {
  let service: MessageClientService;

  beforeEach(() => {
    service = new MessageClientService();
  });

  const history = (conversationId: string, beforeMessageId: string, limit = 10) =>
    service.getRecentHistory({ conversationId, userId: 'u', beforeMessageId, limit });

  it('creates messages with UUID ids (Postgres columns referencing them are uuid)', async () => {
    const user = await service.addUserMessage({ conversationId: 'c1', text: 'hi' });
    const reply = await service.createMessage({ channelId: 'c1', content: 'đang xử lý' });

    expect(user.id).toMatch(UUID);
    expect(reply.id).toMatch(UUID);
    expect(user.id).not.toBe(reply.id);
  });

  it('returns the text of a message by id', async () => {
    const { id } = await service.addUserMessage({ conversationId: 'c1', text: 'xin chào' });

    await expect(service.getMessageText({ id, userId: 'u' })).resolves.toBe('xin chào');
    await expect(service.getMessageText({ id: 'unknown', userId: 'u' })).resolves.toBe('');
  });

  it('keeps the user role for user turns and the LATEST text of an updated reply', async () => {
    await service.addUserMessage({ conversationId: 'c1', text: 'câu 1' });
    const reply = await service.createMessage({ channelId: 'c1', content: '🤖 Đang xử lý...' });
    await service.updateMessage({ id: reply.id, channelId: 'c1', content: 'trả lời 1' });
    const second = await service.addUserMessage({ conversationId: 'c1', text: 'câu 2' });

    await expect(history('c1', second.id)).resolves.toEqual([
      { role: EMessageRole.USER, text: 'câu 1' },
      { role: EMessageRole.MODEL, text: 'trả lời 1' },
    ]);
  });

  it('updates a reply that was created in one call and updated without a channel id', async () => {
    const user = await service.addUserMessage({ conversationId: 'c1', text: 'hỏi' });
    const reply = await service.createMessage({ channelId: 'c1', content: 'placeholder' });
    // Các nhánh lỗi của processor cập nhật mà không gửi channelId.
    await service.tryUpdateMessage({ id: reply.id, content: '⚠️ lỗi hệ thống' });
    const next = await service.addUserMessage({ conversationId: 'c1', text: 'tiếp' });

    await expect(history('c1', next.id)).resolves.toEqual([
      { role: EMessageRole.USER, text: 'hỏi' },
      { role: EMessageRole.MODEL, text: '⚠️ lỗi hệ thống' },
    ]);
    expect(user.id).toMatch(UUID);
  });

  it('excludes the current message and everything after it from the history', async () => {
    await service.addUserMessage({ conversationId: 'c1', text: 'cũ' });
    const current = await service.addUserMessage({ conversationId: 'c1', text: 'hiện tại' });
    await service.createMessage({ channelId: 'c1', content: 'placeholder' });

    await expect(history('c1', current.id)).resolves.toEqual([
      { role: EMessageRole.USER, text: 'cũ' },
    ]);
  });

  it('honors the limit by keeping the most recent turns', async () => {
    for (const text of ['a', 'b', 'c']) {
      await service.addUserMessage({ conversationId: 'c1', text });
    }
    const current = await service.addUserMessage({ conversationId: 'c1', text: 'd' });

    const turns = await history('c1', current.id, 2);

    expect(turns.map((t) => t.text)).toEqual(['b', 'c']);
  });

  it('keeps conversations separate', async () => {
    await service.addUserMessage({ conversationId: 'c1', text: 'của c1' });
    const other = await service.addUserMessage({ conversationId: 'c2', text: 'của c2' });

    await expect(history('c2', other.id)).resolves.toEqual([]);
  });

  it('leaves object messages (approval requests) out of the chat history', async () => {
    await service.addUserMessage({ conversationId: 'c1', text: 'xoá dữ liệu' });
    await service.createMessage({
      channelId: 'c1',
      content: { type: 'approval_request', tool: { name: 'execute_write_query' } },
    });
    const next = await service.addUserMessage({ conversationId: 'c1', text: 'tiếp' });

    await expect(history('c1', next.id)).resolves.toEqual([
      { role: EMessageRole.USER, text: 'xoá dữ liệu' },
    ]);
  });

  describe('onMessage', () => {
    it('notifies created and updated events, with the conversation of the message', async () => {
      const events: MessageEvent[] = [];
      service.onMessage((e) => events.push(e));

      const reply = await service.createMessage({ channelId: 'c1', content: 'placeholder' });
      // Các nhánh lỗi của processor cập nhật mà không gửi channelId.
      await service.updateMessage({ id: reply.id, content: 'câu trả lời cuối' });

      expect(events).toEqual([
        { type: 'created', id: reply.id, conversationId: 'c1', role: EMessageRole.MODEL, content: 'placeholder' },
        { type: 'updated', id: reply.id, conversationId: 'c1', role: EMessageRole.MODEL, content: 'câu trả lời cuối' },
      ]);
    });

    it('notifies user messages with the user role', async () => {
      const events: MessageEvent[] = [];
      service.onMessage((e) => events.push(e));

      await service.addUserMessage({ conversationId: 'c1', text: 'hỏi' });

      expect(events[0]).toMatchObject({ type: 'created', role: EMessageRole.USER, content: 'hỏi' });
    });

    it('passes object content (approval request) through unchanged', async () => {
      const events: MessageEvent[] = [];
      service.onMessage((e) => events.push(e));
      const content = { type: 'approval_request', status: 'pending' };

      await service.createMessage({ channelId: 'c1', content });

      expect(events[0].content).toEqual(content);
    });

    it('stops notifying after unsubscribe and survives a throwing listener', async () => {
      const seen: string[] = [];
      service.onMessage(() => {
        throw new Error('boom');
      });
      const unsubscribe = service.onMessage((e) => seen.push(e.id));

      const first = await service.createMessage({ channelId: 'c1', content: 'a' });
      unsubscribe();
      await service.createMessage({ channelId: 'c1', content: 'b' });

      expect(seen).toEqual([first.id]);
    });
  });

  it('does not record create calls into legacy conversation memory on updateMessage (AC-13)', async () => {
    const recordSuccessfulCreateCalls = jest.fn().mockResolvedValue(undefined);
    const withMemory = new MessageClientService();
    const reply = await withMemory.createMessage({ channelId: 'c1', content: 'x' });
    const toolCalls = [{ tool: 'sql.write', status: 'success' as never }];

    await withMemory.updateMessage({ id: reply.id, channelId: 'c1', content: 'xong', toolCalls });

    expect(recordSuccessfulCreateCalls).not.toHaveBeenCalled();
  });

  it('applies trimTurnsToCharBudget when charBudget is provided to getRecentHistory', async () => {
    await service.addUserMessage({ conversationId: 'c-budget', text: 'turn-1-' + 'a'.repeat(40) });
    await service.createMessage({ channelId: 'c-budget', content: 'ai-2-' + 'b'.repeat(40) });
    const latest = await service.addUserMessage({ conversationId: 'c-budget', text: 'latest-turn' });

    const turns = await service.getRecentHistory({
      conversationId: 'c-budget',
      userId: 'u1',
      beforeMessageId: latest.id,
      limit: 10,
      charBudget: 50,
    });

    expect(turns).toHaveLength(1);
    expect(turns[0].text).toContain('ai-2-');
  });

  it('lưu và truy vấn attachments trong getRecentHistory', async () => {
    const attachment = { type: 'image' as const, url: 'https://example.com/receipt.jpg' };
    await service.addUserMessage({
      conversationId: 'c1',
      text: 'Xem hoá đơn',
      attachments: [attachment],
    });
    const next = await service.addUserMessage({ conversationId: 'c1', text: 'tiếp theo' });

    const turns = await history('c1', next.id);
    expect(turns).toEqual([
      { role: EMessageRole.USER, text: 'Xem hoá đơn', attachments: [attachment] },
    ]);
  });

  it('tryUpdateMessage swallows failures', async () => {
    jest.spyOn(service, 'updateMessage').mockRejectedValue(new Error('db down'));

    await expect(service.tryUpdateMessage({ id: 'x', content: 'y' })).resolves.toBeUndefined();
  });
});
