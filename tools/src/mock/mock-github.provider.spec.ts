import { classifyToolError } from '../executor/tool-error-classifier.util';
import { createMockGithubProvider } from './mock-github.provider';

describe('mock github provider', () => {
  let provider: ReturnType<typeof createMockGithubProvider>;
  const call = (name: string, args: Record<string, unknown> = {}) => provider.call(name, args);
  const text = (r: { content?: Array<{ text?: string }> }) => r.content?.[0]?.text ?? '';
  const numbers = (name: string, args: Record<string, unknown> = {}) => {
    const result = call(name, args);
    expect(result.isError).toBe(false);
    return (JSON.parse(text(result)) as Array<{ number: number }>).map((i) => i.number);
  };
  // list_pull_requests lỗi ở lần gọi đầu (cố ý), nên "dùng cho mọi ca khác" phải gọi bỏ 1 lần trước.
  const warmUp = () => call('list_pull_requests');

  beforeEach(() => {
    provider = createMockGithubProvider();
  });

  it('marks only create_issue as destructive', () => {
    expect(Object.fromEntries(provider.tools.map((t) => [t.name, t.annotations]))).toEqual({
      list_issues: { readOnlyHint: true },
      get_issue: { readOnlyHint: true },
      list_pull_requests: { readOnlyHint: true },
      create_issue: { destructiveHint: true },
    });
  });

  describe('list_issues', () => {
    it('lists open issues by default and never includes pull requests', () => {
      expect(numbers('list_issues')).toEqual([12, 15]);
      expect(numbers('list_issues', { state: 'all' })).toEqual([9, 12, 15]);
    });

    it('filters by state and label', () => {
      expect(numbers('list_issues', { state: 'closed' })).toEqual([9]);
      expect(numbers('list_issues', { label: 'payments' })).toEqual([12]);
      expect(numbers('list_issues', { label: 'Bug' })).toEqual([12]);
    });

    it('refuses an unknown state', () => {
      const result = call('list_issues', { state: 'merged' });

      expect(result.isError).toBe(true);
      expect(text(result)).toContain('open, closed, all');
    });
  });

  describe('get_issue', () => {
    it('returns the body and comments, and accepts the number as a string', () => {
      for (const number of [12, '12']) {
        const issue = JSON.parse(text(call('get_issue', { number })));

        expect(issue).toMatchObject({ number: 12, state: 'open', labels: ['bug', 'payments'] });
        expect(issue.body).toContain('đơn 102');
        expect(issue.comments).toEqual([{ user: 'linh', text: 'Đang làm ở PR #20.' }]);
      }
    });

    it('points a pull request number to list_pull_requests and lists issues for an unknown number', () => {
      const pr = call('get_issue', { number: 20 });
      expect(pr.isError).toBe(true);
      expect(text(pr)).toContain('list_pull_requests');

      const unknown = call('get_issue', { number: 99 });
      expect(unknown.isError).toBe(true);
      expect(text(unknown)).toContain('#9, #12, #15');
    });
  });

  describe('list_pull_requests', () => {
    it('fails once with a retryable error the engine retries silently, then works', () => {
      const first = call('list_pull_requests');

      expect(first.isError).toBe(true);
      expect(classifyToolError(text(first))).toBe('retryable');
      expect(JSON.parse(text(first)).message).toContain('503');

      expect(numbers('list_pull_requests')).toEqual([20, 21]);
      expect(numbers('list_pull_requests')).toEqual([20, 21]);
    });

    it('filters by state and flags the draft PR', () => {
      warmUp();

      expect(numbers('list_pull_requests', { state: 'merged' })).toEqual([8, 18]);
      expect(numbers('list_pull_requests', { state: 'all' })).toEqual([8, 18, 20, 21]);
      const open = JSON.parse(text(call('list_pull_requests')));
      expect(open.find((p: { number: number }) => p.number === 21)).toMatchObject({ draft: true });
      expect(call('list_pull_requests', { state: 'closed' }).isError).toBe(true);
    });

    it('is flaky again on a new instance', () => {
      warmUp();

      provider = createMockGithubProvider();

      expect(call('list_pull_requests').isError).toBe(true);
    });
  });

  describe('create_issue', () => {
    it('creates the next issue number and a later list sees it', () => {
      const created = JSON.parse(text(call('create_issue', { title: 'Lỗi giao hàng', labels: ['bug'] })));

      expect(created).toEqual({
        number: 22,
        title: 'Lỗi giao hàng',
        url: 'https://github.com/acme/shop-backend/issues/22',
      });
      expect(numbers('list_issues')).toEqual([12, 15, 22]);
      expect(JSON.parse(text(call('get_issue', { number: 22 }))).labels).toEqual(['bug']);
    });

    it('refuses a missing title and an unknown label, and creates nothing', () => {
      expect(call('create_issue', { title: ' ' }).isError).toBe(true);
      const result = call('create_issue', { title: 'x', labels: ['urgent'] });
      expect(result.isError).toBe(true);
      expect(text(result)).toContain('bug, enhancement, payments');
      expect(numbers('list_issues')).toEqual([12, 15]);
    });
  });

  it('exposes the repository info as a resource', () => {
    expect(provider.resources[0].read()).toContain('Repo: acme/shop-backend');
    expect(provider.resources[0].read()).toContain('Nhãn: bug, enhancement, payments');
  });
});
