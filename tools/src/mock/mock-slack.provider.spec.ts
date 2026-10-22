import { createMockSlackProvider } from './mock-slack.provider';

describe('mock slack provider', () => {
  let provider: ReturnType<typeof createMockSlackProvider>;
  const call = (name: string, args: Record<string, unknown> = {}) => provider.call(name, args);
  const text = (r: { content?: Array<{ text?: string }> }) => r.content?.[0]?.text ?? '';
  const messages = (channel: string, limit?: number) => {
    const result = call('read_messages', { channel, ...(limit ? { limit } : {}) });
    expect(result.isError).toBe(false);
    return JSON.parse(text(result)).messages as Array<{ user: string; text: string }>;
  };

  beforeEach(() => {
    provider = createMockSlackProvider();
  });

  it('marks only post_message as destructive', () => {
    expect(Object.fromEntries(provider.tools.map((t) => [t.name, t.annotations]))).toEqual({
      list_channels: { readOnlyHint: true },
      read_messages: { readOnlyHint: true },
      post_message: { destructiveHint: true },
    });
  });

  it('lists the three channels', () => {
    const channels = JSON.parse(text(call('list_channels')));

    expect(channels.map((c: { name: string }) => c.name)).toEqual(['#sales', '#ops', '#general']);
    expect(channels[1]).toMatchObject({ id: 'C02', topic: 'Vận hành, thanh toán và kho' });
  });

  describe('read_messages', () => {
    it('finds a channel by name, by name with #, by id and in another case', () => {
      for (const ref of ['ops', '#ops', 'C02', 'OPS']) {
        expect(messages(ref)).toHaveLength(3);
      }
    });

    it('returns the order #102 incident in #ops, oldest first', () => {
      const ops = messages('ops');

      expect(ops[0].text).toContain('đơn 102 bị treo');
      expect(ops[1].text).toContain('issue GitHub #12');
    });

    it('honors limit by keeping the newest messages', () => {
      expect(messages('ops', 1).map((m) => m.user)).toEqual(['minh']);
      expect(messages('ops', 1)[0].text).toContain('Giày thể thao chỉ còn 8 đôi');
    });

    it.each([
      ['an unknown channel', { channel: 'random' }, '#sales, #ops, #general'],
      ['a missing channel', {}, 'Thiếu tham số "channel"'],
    ])('returns a helpful error for %s', (_label, args, message) => {
      const result = call('read_messages', args);

      expect(result.isError).toBe(true);
      expect(text(result)).toContain(message);
    });
  });

  describe('post_message', () => {
    it('adds the message to the channel and a later read sees it', () => {
      const result = call('post_message', { channel: '#sales', text: 'Đơn 102 đã được xử lý' });

      expect(JSON.parse(text(result))).toMatchObject({ ok: true, channel: '#sales' });
      expect(messages('sales').at(-1)).toMatchObject({ user: 'bot', text: 'Đơn 102 đã được xử lý' });
      expect(messages('ops')).toHaveLength(3);
    });

    it('refuses an empty text and an unknown channel', () => {
      expect(call('post_message', { channel: 'sales', text: '  ' }).isError).toBe(true);
      expect(call('post_message', { channel: 'nope', text: 'hi' }).isError).toBe(true);
      expect(messages('sales')).toHaveLength(2);
    });
  });

  it('exposes the channel catalog as a resource', () => {
    expect(provider.resources[0].read()).toBe(
      [
        '#sales (C01): Bán hàng và doanh thu, 8 thành viên',
        '#ops (C02): Vận hành, thanh toán và kho, 5 thành viên',
        '#general (C03): Thông báo chung, 12 thành viên',
      ].join('\n'),
    );
  });
});
