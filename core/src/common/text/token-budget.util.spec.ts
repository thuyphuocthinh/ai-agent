import {
  capRoundResults,
  capRoundResultsWeighted,
  capToolResultSize,
  resolveDataCharBudget,
  resolveMemoryCharBudget,
  resolveHistoryCharBudget,
  isLikelyReadOnlyRound,
  CHARS_PER_TOKEN_ESTIMATE,
  MAX_TOOL_RESULT_CHARS,
} from './token-budget.util';

describe('token-budget.util', () => {
  describe('capToolResultSize', () => {
    it('returns raw text unchanged if under maxChars', () => {
      const text = 'short output';
      expect(capToolResultSize(text, 100)).toBe(text);
    });

    it('truncates cleanly when text exceeds maxChars', () => {
      const longText = 'a'.repeat(200);
      const capped = capToolResultSize(longText, 50);
      expect(capped.length).toBeLessThanOrEqual(50);
    });

    it('minifies json if possible', () => {
      const json = JSON.stringify({ key: 'value', emptyArr: [], nullVal: null });
      const capped = capToolResultSize(json, 1000);
      expect(capped).toContain('"key":"value"');
      expect(capped).not.toContain('nullVal');
    });

    it('uses ToolOutputCompressor to safely preserve JSON envelope and dataRef when array exceeds budget', () => {
      const largeArray = Array.from({ length: 100 }, (_, i) => ({
        id: i,
        name: `Customer ${i}`,
        description: 'Detail text for enterprise customer data mapping',
      }));
      const rawJson = JSON.stringify(largeArray);
      const capped = capToolResultSize(rawJson, 1000);
      expect(capped.length).toBeLessThanOrEqual(1000);
      // Phải là JSON hợp lệ, không bị syntax error
      const parsed = JSON.parse(capped);
      expect(parsed._data_summary).toBeDefined();
      expect(parsed._data_summary.total_records).toBe(100);
      expect(parsed._data_summary.dataRef).toBeDefined();
      expect(parsed.sample_records.length).toBeGreaterThan(0);
    });

    it('truncates JSON array at item boundaries and closes with valid syntax when budget is very constrained', () => {
      const records = Array.from({ length: 50 }, (_, i) => ({
        id: i,
        code: `CODE_${i}`,
        val: i * 10,
      }));
      const rawJson = JSON.stringify(records);
      // Ngân sách 250 ký tự (ToolOutputCompressor envelope không vừa 250 ký tự)
      const capped = capToolResultSize(rawJson, 250);
      expect(capped.length).toBeLessThanOrEqual(250);
      // Kết quả BẮT BUỘC phải là JSON hợp lệ (parse được)
      const parsed = JSON.parse(capped);
      expect(Array.isArray(parsed)).toBe(true);
      const lastItem = parsed[parsed.length - 1];
      expect(lastItem._metadata).toBeDefined();
      expect(lastItem._metadata).toContain('đã cắt bớt');
    });
  });

  describe('resolveDataCharBudget', () => {
    it('returns 6000 for unknown model', () => {
      expect(resolveDataCharBudget('unknown-model')).toBe(MAX_TOOL_RESULT_CHARS);
    });

    it('scales for known model up to ceiling', () => {
      const gpt4oBudget = resolveDataCharBudget('gpt-4o');
      expect(gpt4oBudget).toBeGreaterThan(MAX_TOOL_RESULT_CHARS);
      expect(gpt4oBudget).toBeLessThanOrEqual(200_000);
    });
  });

  describe('isLikelyReadOnlyRound', () => {
    it('detects read-only queries', () => {
      expect(isLikelyReadOnlyRound({ task: 'Tra cứu danh sách nhân viên' })).toBe(true);
      expect(isLikelyReadOnlyRound({ task: 'SELECT * FROM users' })).toBe(true);
      expect(isLikelyReadOnlyRound({ task: 'fetch latest orders' })).toBe(true);
    });

    it('detects write operations as not read-only', () => {
      expect(isLikelyReadOnlyRound({ task: 'Cập nhật trạng thái đơn hàng' })).toBe(false);
      expect(isLikelyReadOnlyRound({ task: 'Delete invalid records' })).toBe(false);
    });
  });

  describe('capRoundResults & capRoundResultsWeighted', () => {
    it('caps round results evenly', () => {
      const rounds = [
        { task: 'query 1', result: 'hello world' },
        { task: 'query 2', result: 'foo bar' },
      ];
      const capped = capRoundResults(rounds, 1000);
      expect(capped.length).toBe(2);
      expect(capped[0].result).toBe('hello world');
    });

    it('weights rounds based on read-only vs destructive', () => {
      const rounds = [
        { task: 'tra cứu dữ liệu', result: 'result 1' },
        { task: 'cập nhật database', result: 'result 2' },
      ];
      const capped = capRoundResultsWeighted(rounds, 1000);
      expect(capped.length).toBe(2);
      expect(capped[0].result).toBeDefined();
      expect(capped[1].result).toBeDefined();
    });
  });
});
