export interface ToolActionPolicyRule {
  provider?: string | RegExp;
  tool: string | RegExp;
  template: string | ((args: Record<string, unknown>) => string);
}

/**
 * Danh mục quy tắc chính sách định dạng tóm tắt hành động (Declarative Policy Rules).
 * Dễ dàng mở rộng thêm provider/tool mới mà không cần can thiệp logic code.
 */
export const DEFAULT_ACTION_SUMMARY_POLICIES: ToolActionPolicyRule[] = [
  // GitHub Provider
  {
    provider: /github/i,
    tool: /create_issue/i,
    template: 'Tạo issue mới trên GitHub: "#{title}"',
  },
  {
    provider: /github/i,
    tool: /list_issues|get_issue/i,
    template: 'Tra cứu danh sách issue trên GitHub',
  },
  {
    provider: /github/i,
    tool: /create_pull|merge_pull/i,
    template: 'Thao tác Pull Request trên GitHub',
  },

  // Slack Provider
  {
    provider: /slack/i,
    tool: /send_message|post_message/i,
    template: (args) => {
      const channel = args.channel ? ` (kênh #${args.channel})` : '';
      return `Gửi tin nhắn qua Slack${channel}`;
    },
  },
  {
    provider: /slack/i,
    tool: /list_messages|history/i,
    template: 'Đọc lịch sử tin nhắn Slack',
  },

  // Google Sheets Provider
  {
    provider: /google_sheets|sheets/i,
    tool: /write|append|update/i,
    template: 'Cập nhật dữ liệu bảng tính Google Sheets',
  },
  {
    provider: /google_sheets|sheets/i,
    tool: /read|get/i,
    template: 'Đọc dữ liệu bảng tính Google Sheets',
  },

  // Google Mail Provider
  {
    provider: /google_mail|gmail/i,
    tool: /send/i,
    template: (args) => (args.to ? `Gửi thư qua Gmail tới ${args.to}` : 'Gửi thư qua Gmail'),
  },
  {
    provider: /google_mail|gmail/i,
    tool: /list|search/i,
    template: 'Tra cứu hộp thư Gmail',
  },

  // Python Compute Provider
  {
    provider: /compute|python/i,
    tool: /execute_python|run/i,
    template: 'Thực thi tính toán dữ liệu bằng Python',
  },
];

/**
 * Thay thế các placeholder dạng #{fieldName} bằng giá trị trong args.
 */
export function interpolateTemplate(
  template: string,
  args: Record<string, unknown> = {},
): string {
  return template.replace(/#\{([a-zA-Z0-9_]+)\}/g, (_, field) => {
    const val = args[field];
    return val !== undefined && val !== null ? String(val) : '';
  }).trim();
}
