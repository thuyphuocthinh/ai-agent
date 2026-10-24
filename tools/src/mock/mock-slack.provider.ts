import { CallToolResponseDto, McpToolDto } from '../contracts';
import { MockProvider, errorResult, isToolResult, jsonResult, limitArg, stringArg } from './mock-provider';

export const MOCK_SLACK_PROVIDER_ID = 'slack';

interface Message {
  ts: string;
  user: string;
  text: string;
}
interface Channel {
  id: string;
  name: string;
  topic: string;
  members: number;
  messages: Message[];
}

// Liên kết với SQL/GitHub mẫu: #ops nói về đơn 102 kẹt pending và issue #12.
const createChannels = (): Channel[] => [
  {
    id: 'C01',
    name: 'sales',
    topic: 'Bán hàng và doanh thu',
    members: 8,
    messages: [
      { ts: '2026-10-20 09:05', user: 'linh', text: 'Tuần này đã chốt 3 đơn, doanh thu các đơn đã thanh toán là 497.000đ.' },
      { ts: '2026-10-20 14:30', user: 'huy', text: 'Khách Bình hỏi đơn 102 bao giờ giao, ai xử lý giúp với?' },
    ],
  },
  {
    id: 'C02',
    name: 'ops',
    topic: 'Vận hành, thanh toán và kho',
    members: 5,
    messages: [
      { ts: '2026-10-19 08:10', user: 'minh', text: 'Cổng thanh toán timeout từ sáng 2/10, đơn 102 bị treo ở trạng thái pending.' },
      { ts: '2026-10-19 08:42', user: 'linh', text: 'Đã báo bên payment, theo dõi ở issue GitHub #12, PR sửa là #20.' },
      { ts: '2026-10-21 16:00', user: 'minh', text: 'Giày thể thao chỉ còn 8 đôi, cần nhập thêm trước cuối tháng.' },
    ],
  },
  {
    id: 'C03',
    name: 'general',
    topic: 'Thông báo chung',
    members: 12,
    messages: [
      { ts: '2026-10-15 09:00', user: 'admin', text: 'Chào mừng thành viên mới tham gia nhóm!' },
      { ts: '2026-10-21 10:00', user: 'admin', text: 'Họp tổng kết tháng vào thứ Sáu lúc 16h.' },
    ],
  },
];

const CHANNEL_SCHEMA = { type: 'string', description: 'Tên kênh (có hoặc không có #) hoặc id, ví dụ "ops"' };

const TOOLS: McpToolDto[] = [
  {
    name: 'list_channels',
    description: 'Liệt kê các kênh (id, tên, chủ đề, số thành viên).',
    inputSchema: { type: 'object', properties: {} },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'read_messages',
    description: 'Đọc các tin nhắn gần nhất của 1 kênh (cũ trước, mới sau).',
    inputSchema: {
      type: 'object',
      properties: { channel: CHANNEL_SCHEMA, limit: { type: 'integer', description: 'Số tin tối đa, mặc định 20' } },
      required: ['channel'],
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'post_message',
    description: 'Đăng tin nhắn vào 1 kênh, mọi thành viên đều thấy. Cần người dùng duyệt trước khi chạy.',
    inputSchema: {
      type: 'object',
      properties: { channel: CHANNEL_SCHEMA, text: { type: 'string' } },
      required: ['channel', 'text'],
    },
    annotations: { destructiveHint: true },
  },
];

const catalogLine = (c: Channel) => `#${c.name} (${c.id}): ${c.topic}, ${c.members} thành viên`;

/** Slack giả: 3 kênh cố định; tin đăng thêm được lưu trong bộ nhớ và mất khi dựng lại. */
export function createMockSlackProvider(): MockProvider {
  const channels = createChannels();
  const findChannel = (args: Record<string, unknown>): Channel | CallToolResponseDto => {
    const ref = stringArg(args, 'channel');
    if (!ref) return errorResult('Thiếu tham số "channel"');
    const name = ref.replace(/^#/, '').toLowerCase();
    return (
      channels.find((c) => c.id.toLowerCase() === name || c.name === name) ??
      errorResult(`Không tìm thấy kênh "${ref}". Kênh hiện có: ${channels.map((c) => `#${c.name}`).join(', ')}`)
    );
  };

  const handlers: Record<string, MockProvider['call']> = {
    list_channels: () =>
      jsonResult(channels.map(({ id, name, topic, members }) => ({ id, name: `#${name}`, topic, members }))),
    read_messages: (_name, args) => {
      const channel = findChannel(args);
      if (isToolResult(channel)) return channel;
      return jsonResult({ channel: `#${channel.name}`, messages: channel.messages.slice(-limitArg(args, 'limit', 20)) });
    },
    post_message: (_name, args) => {
      const channel = findChannel(args);
      if (isToolResult(channel)) return channel;
      const text = stringArg(args, 'text');
      if (!text) return errorResult('Thiếu nội dung "text" (không rỗng)');
      const message = { ts: '2026-10-22 09:00', user: 'bot', text };
      channel.messages.push(message);
      return jsonResult({ ok: true, channel: `#${channel.name}`, ts: message.ts });
    },
  };

  return {
    id: MOCK_SLACK_PROVIDER_ID,
    tools: TOOLS,
    resources: [
      {
        dto: {
          uri: 'mock://slack/channels',
          name: 'Danh sách kênh Slack',
          description: 'Các kênh và chủ đề',
          mimeType: 'text/plain',
        },
        read: () => channels.map(catalogLine).join('\n'),
      },
    ],
    call: (name, args) => handlers[name](name, args),
  };
}
