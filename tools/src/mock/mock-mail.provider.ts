import { McpToolDto } from '@agent/core/dto/mcp.dto';
import { MockProvider, errorResult, jsonResult, limitArg, stringArg } from './mock-provider';

export const MOCK_MAIL_PROVIDER_ID = 'google_mail';

type Label = 'inbox' | 'sent' | 'draft';
interface Email {
  id: string;
  label: Label;
  from: string;
  to: string;
  subject: string;
  date: string;
  body: string;
  unread: boolean;
}

const ME = 'shop@example.com';
const LABELS: Label[] = ['inbox', 'sent', 'draft'];

// Liên kết với SQL mẫu: Bình = khách đơn 102 (pending), An = đơn 101; nhà cung cấp báo giá Giày thể thao.
const createInbox = (): Email[] => [
  {
    id: 'm1',
    label: 'inbox',
    from: 'Bình <binh@example.com>',
    to: ME,
    subject: 'Đơn 102 chưa nhận được hàng',
    date: '2026-10-20',
    body: 'Chào shop, mình đặt đơn 102 (giày thể thao, 699.000đ) hôm 2/10 nhưng chưa thanh toán xong vì trang thanh toán bị lỗi. Shop hỗ trợ giúp mình nhé. — Bình',
    unread: true,
  },
  {
    id: 'm2',
    label: 'inbox',
    from: 'Sneaker Hub <sales@sneakerhub.vn>',
    to: ME,
    subject: 'Báo giá mới Giày thể thao Q4',
    date: '2026-10-19',
    body: 'Kính gửi shop, giá nhập mới của Giày thể thao là 480.000đ/đôi (giảm từ 520.000đ). Giá bán lẻ đề xuất mới: 649.000đ. Áp dụng từ 01/11/2026, báo giá có hiệu lực đến 31/10/2026. Trân trọng, Sneaker Hub.',
    unread: true,
  },
  {
    id: 'm3',
    label: 'inbox',
    from: 'Retail News <newsletter@retailnews.vn>',
    to: ME,
    subject: 'Bản tin bán lẻ tuần 42',
    date: '2026-10-18',
    body: 'Xu hướng bán lẻ tuần này: thanh toán không tiền mặt tăng 12%, nhiều cửa hàng giảm giá cuối mùa. Đọc thêm tại website.',
    unread: false,
  },
  {
    id: 'm4',
    label: 'inbox',
    from: 'An <an@example.com>',
    to: ME,
    subject: 'Cảm ơn shop',
    date: '2026-10-17',
    body: 'Áo thun mình nhận được rất ưng ý, giao hàng nhanh. Mình sẽ ủng hộ shop tiếp. — An',
    unread: false,
  },
  {
    id: 'm5',
    label: 'inbox',
    from: 'CloudHost <billing@cloudhost.vn>',
    to: ME,
    subject: 'Hoá đơn tháng 10',
    date: '2026-10-15',
    body: 'Hoá đơn hosting tháng 10/2026. Tổng tiền: 1.250.000đ. Hạn thanh toán: 25/10/2026.',
    unread: false,
  },
];

const TOOLS: McpToolDto[] = [
  {
    name: 'search_emails',
    description: 'Tìm email theo từ khoá (người gửi, tiêu đề, nội dung) và nhãn. Trả về tóm tắt, dùng read_email để đọc đầy đủ.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Từ khoá (bỏ trống = tất cả)' },
        label: { type: 'string', enum: LABELS, description: 'Nhãn, mặc định inbox' },
        limit: { type: 'integer', description: 'Số email tối đa, mặc định 10' },
      },
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'read_email',
    description: 'Đọc đầy đủ 1 email theo id (lấy từ search_emails).',
    inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'create_draft',
    description: 'Soạn thư nháp (chưa gửi) — an toàn, không cần duyệt.',
    inputSchema: {
      type: 'object',
      properties: { to: { type: 'string' }, subject: { type: 'string' }, body: { type: 'string' } },
      required: ['to', 'subject', 'body'],
    },
  },
  {
    name: 'send_email',
    description: 'GỬI email thật tới người nhận. Cần người dùng duyệt trước khi chạy.',
    inputSchema: {
      type: 'object',
      properties: { to: { type: 'string' }, subject: { type: 'string' }, body: { type: 'string' } },
      required: ['to', 'subject', 'body'],
    },
    annotations: { destructiveHint: true },
  },
];

const EMAIL_ADDRESS = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;
// "Bình <binh@example.com>" hoặc "binh@example.com" -> địa chỉ thuần.
const addressOf = (recipient: string) => /<([^>]+)>/.exec(recipient)?.[1] ?? recipient;

const summarize = (e: Email) => ({
  id: e.id,
  from: e.from,
  to: e.to,
  subject: e.subject,
  date: e.date,
  label: e.label,
  unread: e.unread,
  snippet: e.body.length > 80 ? `${e.body.slice(0, 80)}…` : e.body,
});

/** Gmail giả: hộp thư 5 email cố định; thư gửi/nháp được lưu trong bộ nhớ và mất khi dựng lại. */
export function createMockMailProvider(): MockProvider {
  const emails = createInbox();
  let nextId = emails.length + 1;
  const today = '2026-10-22';

  const compose = (label: Label, args: Record<string, unknown>) => {
    const to = stringArg(args, 'to');
    const subject = stringArg(args, 'subject');
    const body = stringArg(args, 'body');
    if (!to || !subject || !body) return errorResult('Cần đủ "to", "subject" và "body" (không rỗng)');
    if (!EMAIL_ADDRESS.test(addressOf(to))) return errorResult(`Địa chỉ người nhận "${to}" không hợp lệ`);
    const email: Email = { id: `m${nextId++}`, label, from: ME, to, subject, date: today, body, unread: false };
    emails.push(email);
    return jsonResult({ id: email.id, status: label === 'sent' ? 'sent' : 'draft', to, subject });
  };

  const handlers: Record<string, MockProvider['call']> = {
    search_emails: (_name, args) => {
      const label = stringArg(args, 'label') ?? 'inbox';
      if (!LABELS.includes(label as Label)) return errorResult(`Nhãn "${label}" không hợp lệ. Nhãn hợp lệ: ${LABELS.join(', ')}`);
      const query = stringArg(args, 'query')?.toLowerCase();
      const found = emails
        .filter((e) => e.label === label)
        .filter((e) => !query || `${e.from} ${e.subject} ${e.body}`.toLowerCase().includes(query))
        .slice(0, limitArg(args, 'limit', 10));
      return jsonResult(found.map(summarize));
    },
    read_email: (_name, args) => {
      const id = stringArg(args, 'id');
      const email = emails.find((e) => e.id === id);
      if (!email) {
        return errorResult(`Không tìm thấy email "${id ?? ''}". Id hiện có: ${emails.map((e) => e.id).join(', ')}`);
      }
      email.unread = false;
      return jsonResult({ ...summarize(email), snippet: undefined, body: email.body });
    },
    create_draft: (_name, args) => compose('draft', args),
    send_email: (_name, args) => compose('sent', args),
  };

  return { id: MOCK_MAIL_PROVIDER_ID, tools: TOOLS, resources: [], call: (name, args) => handlers[name](name, args) };
}
