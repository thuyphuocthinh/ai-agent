import { createMockMailProvider } from './mock-mail.provider';

describe('mock google_mail provider', () => {
  let provider: ReturnType<typeof createMockMailProvider>;
  const call = (name: string, args: Record<string, unknown> = {}) => provider.call(name, args);
  const text = (r: { content?: Array<{ text?: string }> }) => r.content?.[0]?.text ?? '';
  const search = (args: Record<string, unknown> = {}) => {
    const result = call('search_emails', args);
    expect(result.isError).toBe(false);
    return JSON.parse(text(result)) as Array<{ id: string; unread: boolean; label: string; snippet: string }>;
  };
  const ids = (args: Record<string, unknown> = {}) => search(args).map((e) => e.id);

  beforeEach(() => {
    provider = createMockMailProvider();
  });

  it('marks only send_email as destructive; drafting is a safe write', () => {
    const hints = Object.fromEntries(provider.tools.map((t) => [t.name, t.annotations]));

    expect(hints).toEqual({
      search_emails: { readOnlyHint: true },
      read_email: { readOnlyHint: true },
      create_draft: undefined,
      send_email: { destructiveHint: true },
    });
    expect(provider.resources).toEqual([]);
  });

  describe('search_emails', () => {
    it('lists the inbox by default, with a short snippet', () => {
      const emails = search();

      expect(emails.map((e) => e.id)).toEqual(['m1', 'm2', 'm3', 'm4', 'm5']);
      expect(emails.every((e) => e.label === 'inbox')).toBe(true);
      expect(emails[0].snippet.length).toBeLessThanOrEqual(81);
    });

    it('filters by sender, subject and body, ignoring case', () => {
      expect(ids({ query: 'BÁO GIÁ' })).toEqual(['m2']);
      expect(ids({ query: 'binh@example.com' })).toEqual(['m1']);
      expect(ids({ query: 'giày thể thao' })).toEqual(['m1', 'm2']);
      expect(ids({ query: 'không có thư nào thế này' })).toEqual([]);
    });

    it('honors limit and the label, and refuses an unknown label', () => {
      expect(ids({ limit: 2 })).toEqual(['m1', 'm2']);
      expect(ids({ label: 'sent' })).toEqual([]);

      const result = call('search_emails', { label: 'spam' });
      expect(result.isError).toBe(true);
      expect(text(result)).toContain('inbox, sent, draft');
    });
  });

  describe('read_email', () => {
    it('returns the full body and marks the email as read', () => {
      expect(search().find((e) => e.id === 'm1')?.unread).toBe(true);

      const email = JSON.parse(text(call('read_email', { id: 'm2' })));

      expect(email.body).toContain('649.000đ');
      expect(email.from).toContain('sneakerhub');
      expect(search().find((e) => e.id === 'm2')?.unread).toBe(false);
    });

    it('lists the valid ids for an unknown email', () => {
      const result = call('read_email', { id: 'm99' });

      expect(result.isError).toBe(true);
      expect(text(result)).toContain('m1, m2, m3, m4, m5');
    });
  });

  describe('create_draft and send_email', () => {
    const message = { to: 'binh@example.com', subject: 'Nhắc thanh toán đơn 102', body: 'Mời anh thanh toán đơn 102.' };

    it('keeps a draft out of the inbox and sent, and numbers new emails after the existing ones', () => {
      const draft = JSON.parse(text(call('create_draft', message)));

      expect(draft).toMatchObject({ id: 'm6', status: 'draft' });
      expect(ids({ label: 'draft' })).toEqual(['m6']);
      expect(ids({ label: 'sent' })).toEqual([]);
      expect(ids()).toHaveLength(5);
    });

    it('records a sent email and accepts a "Name <address>" recipient', () => {
      const sent = JSON.parse(text(call('send_email', { ...message, to: 'Bình <binh@example.com>' })));

      expect(sent).toMatchObject({ id: 'm6', status: 'sent', to: 'Bình <binh@example.com>' });
      expect(ids({ label: 'sent' })).toEqual(['m6']);
    });

    it.each([
      ['an invalid address', { to: 'not-an-email' }],
      ['a missing subject', { subject: '' }],
      ['a missing body', { body: '   ' }],
    ])('refuses %s and sends nothing', (_label, override) => {
      const result = call('send_email', { ...message, ...override });

      expect(result.isError).toBe(true);
      expect(ids({ label: 'sent' })).toEqual([]);
    });
  });

  it('starts from the original inbox again on a new instance', () => {
    call('send_email', { to: 'a@b.vn', subject: 's', body: 'b' });

    provider = createMockMailProvider();

    expect(ids({ label: 'sent' })).toEqual([]);
  });
});
