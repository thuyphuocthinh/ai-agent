import { McpToolDto } from '@agent/core/dto/mcp.dto';
import {
  MockProvider,
  errorResult,
  jsonResult,
  retryableErrorResult,
  stringArg,
} from './mock-provider';

export const MOCK_GITHUB_PROVIDER_ID = 'github';

type State = 'open' | 'closed' | 'merged';
interface Comment {
  user: string;
  text: string;
}
interface Item {
  number: number;
  kind: 'issue' | 'pr';
  title: string;
  state: State;
  author: string;
  created: string;
  labels: string[];
  body: string;
  comments: Comment[];
  draft?: boolean;
}

const REPO = 'acme/shop-backend';
const LABELS = ['bug', 'enhancement', 'payments'];

// Liên kết với SQL/Slack mẫu: issue #12 là lỗi cổng thanh toán làm đơn 102 kẹt pending, PR #20 sửa nó.
const createItems = (): Item[] => [
  { number: 8, kind: 'pr', title: 'fix: làm tròn tổng tiền khi áp mã giảm giá', state: 'merged', author: 'linh', created: '2026-09-11', labels: ['bug'], body: 'Sửa sai số 1.000đ khi áp mã giảm 10%. Closes #9.', comments: [] },
  { number: 9, kind: 'issue', title: 'Sai tổng tiền khi áp mã giảm giá', state: 'closed', author: 'linh', created: '2026-09-10', labels: ['bug'], body: 'Tổng tiền đơn bị tính sai 1.000đ khi áp mã giảm 10%.', comments: [{ user: 'minh', text: 'Đã fix ở PR #8, đóng issue.' }] },
  { number: 12, kind: 'issue', title: 'Cổng thanh toán timeout làm đơn kẹt ở pending', state: 'open', author: 'minh', created: '2026-10-02', labels: ['bug', 'payments'], body: 'Từ 02/10 request tới cổng thanh toán timeout sau ~30s nên đơn không chuyển sang paid (ví dụ đơn 102 của khách Bình). Cần tăng timeout và thêm retry.', comments: [{ user: 'linh', text: 'Đang làm ở PR #20.' }] },
  { number: 15, kind: 'issue', title: 'Thêm cột tracking_number cho bảng orders', state: 'open', author: 'huy', created: '2026-10-10', labels: ['enhancement'], body: 'Để khách tra cứu vận đơn.', comments: [] },
  { number: 18, kind: 'pr', title: 'feat: xuất báo cáo doanh thu CSV', state: 'merged', author: 'huy', created: '2026-10-14', labels: ['enhancement'], body: 'Thêm endpoint xuất doanh thu theo tháng.', comments: [] },
  { number: 20, kind: 'pr', title: 'fix: tăng timeout và retry khi gọi cổng thanh toán', state: 'open', author: 'linh', created: '2026-10-18', labels: ['bug', 'payments'], body: 'Tăng timeout lên 60s, retry 2 lần. Closes #12. Checks: passing.', comments: [] },
  { number: 21, kind: 'pr', title: 'chore: nâng cấp NestJS 11', state: 'open', author: 'minh', created: '2026-10-20', labels: [], body: 'Nâng cấp phụ thuộc. Checks: failing (1 test lỗi).', comments: [], draft: true },
];

const TOOLS: McpToolDto[] = [
  {
    name: 'list_issues',
    description: `Liệt kê issue của repo ${REPO} (không gồm pull request).`,
    inputSchema: {
      type: 'object',
      properties: {
        state: { type: 'string', enum: ['open', 'closed', 'all'], description: 'Mặc định open' },
        label: { type: 'string', description: `Lọc theo nhãn: ${LABELS.join(', ')}` },
      },
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'get_issue',
    description: 'Xem chi tiết 1 issue (nội dung và bình luận) theo số.',
    inputSchema: { type: 'object', properties: { number: { type: 'integer' } }, required: ['number'] },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'list_pull_requests',
    description: `Liệt kê pull request của repo ${REPO}.`,
    inputSchema: {
      type: 'object',
      properties: { state: { type: 'string', enum: ['open', 'merged', 'all'], description: 'Mặc định open' } },
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'create_issue',
    description: `Tạo issue mới trong repo ${REPO}. Cần người dùng duyệt trước khi chạy.`,
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        body: { type: 'string' },
        labels: { type: 'array', items: { type: 'string' } },
      },
      required: ['title'],
    },
    annotations: { destructiveHint: true },
  },
];

const summarize = (i: Item) => ({
  number: i.number,
  title: i.title,
  state: i.state,
  author: i.author,
  created: i.created,
  labels: i.labels,
  comments: i.comments.length,
  ...(i.draft ? { draft: true } : {}),
});

/**
 * GitHub giả: repo acme/shop-backend với 3 issue và 4 PR cố định; issue tạo thêm được lưu
 * trong bộ nhớ. `list_pull_requests` lỗi tạm thời (retryable) ở lần gọi ĐẦU TIÊN để test
 * cơ chế tự thử lại ngầm của engine; các lần sau chạy bình thường.
 */
export function createMockGithubProvider(): MockProvider {
  const items = createItems();
  let nextNumber = Math.max(...items.map((i) => i.number)) + 1;
  let flakyServed = false;

  const handlers: Record<string, MockProvider['call']> = {
    list_issues: (_name, args) => {
      const state = stringArg(args, 'state') ?? 'open';
      if (!['open', 'closed', 'all'].includes(state)) return errorResult(`state "${state}" không hợp lệ. Dùng: open, closed, all`);
      const label = stringArg(args, 'label')?.toLowerCase();
      const found = items
        .filter((i) => i.kind === 'issue')
        .filter((i) => state === 'all' || i.state === state)
        .filter((i) => !label || i.labels.includes(label));
      return jsonResult(found.map(summarize));
    },
    get_issue: (_name, args) => {
      const number = Number(args.number); // model đôi khi truyền "12" dạng chuỗi
      const item = items.find((i) => i.number === number);
      if (item?.kind === 'pr') return errorResult(`#${item.number} là pull request, dùng list_pull_requests`);
      if (!item) {
        const known = items.filter((i) => i.kind === 'issue').map((i) => `#${i.number}`);
        return errorResult(`Issue #${String(args.number)} không tồn tại. Các issue hiện có: ${known.join(', ')}`);
      }
      return jsonResult({ ...summarize(item), body: item.body, comments: item.comments });
    },
    list_pull_requests: (_name, args) => {
      if (!flakyServed) {
        flakyServed = true;
        return retryableErrorResult('503 Service Unavailable — GitHub API tạm thời quá tải, thử lại sau');
      }
      const state = stringArg(args, 'state') ?? 'open';
      if (!['open', 'merged', 'all'].includes(state)) return errorResult(`state "${state}" không hợp lệ. Dùng: open, merged, all`);
      const found = items.filter((i) => i.kind === 'pr' && (state === 'all' || i.state === state));
      return jsonResult(found.map((i) => ({ ...summarize(i), summary: i.body })));
    },
    create_issue: (_name, args) => {
      const title = stringArg(args, 'title');
      if (!title) return errorResult('Thiếu "title" (không rỗng)');
      const labels = Array.isArray(args.labels) ? args.labels.filter((l): l is string => typeof l === 'string') : [];
      const unknown = labels.filter((l) => !LABELS.includes(l));
      if (unknown.length > 0) return errorResult(`Nhãn không tồn tại: ${unknown.join(', ')}. Nhãn hợp lệ: ${LABELS.join(', ')}`);
      const issue: Item = {
        number: nextNumber++,
        kind: 'issue',
        title,
        state: 'open',
        author: 'bot',
        created: '2026-10-22',
        labels,
        body: stringArg(args, 'body') ?? '',
        comments: [],
      };
      items.push(issue);
      return jsonResult({ number: issue.number, title, url: `https://github.com/${REPO}/issues/${issue.number}` });
    },
  };

  return {
    id: MOCK_GITHUB_PROVIDER_ID,
    tools: TOOLS,
    resources: [
      {
        dto: {
          uri: 'mock://github/repo',
          name: 'Thông tin repository',
          description: 'Repo, nhánh mặc định và nhãn',
          mimeType: 'text/plain',
        },
        read: () =>
          [
            `Repo: ${REPO}`,
            'Mô tả: Backend NestJS của cửa hàng online',
            'Nhánh mặc định: main',
            `Nhãn: ${LABELS.join(', ')}`,
          ].join('\n'),
      },
    ],
    call: (name, args) => handlers[name](name, args),
  };
}
