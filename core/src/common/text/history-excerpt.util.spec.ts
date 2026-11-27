import {
  extractKeywordSnippet,
  scoreHistoryMatch,
  splitSearchKeywords,
} from './history-excerpt.util';

describe('history-excerpt.util', () => {
  describe('splitSearchKeywords', () => {
    it('strips edge punctuation, deduplicates case-insensitively, prefers longer tokens, and caps at 10 keywords', () => {
      const res = splitSearchKeywords(
        '  ORD-8899, VIP-9910  ord-8899  a b c d e f g h i j k ',
      );
      expect(res).toHaveLength(10);
      expect(res.slice(0, 2)).toEqual(['ORD-8899', 'VIP-9910']);
      expect(res.filter((k) => k.toLowerCase() === 'ord-8899')).toHaveLength(1);
    });

    it('returns empty array for blank or undefined input', () => {
      expect(splitSearchKeywords(undefined)).toEqual([]);
      expect(splitSearchKeywords('   ')).toEqual([]);
    });
  });

  describe('scoreHistoryMatch', () => {
    it('awards exact-phrase bonus and counts matched keywords', () => {
      const exact = scoreHistoryMatch(
        'Người phụ trách phê duyệt cuối là chị Minh Anh.',
        'phê duyệt cuối',
        ['duyệt', 'cuối', 'phê'],
      );
      const partial = scoreHistoryMatch(
        'Cuối ngày nhớ khóa cửa.',
        'phê duyệt cuối',
        ['duyệt', 'cuối', 'phê'],
      );

      expect(exact.matchedCount).toBe(3);
      expect(partial.matchedCount).toBe(1);
      expect(exact.score).toBeGreaterThan(partial.score);
    });
  });

  describe('extractKeywordSnippet', () => {
    it('returns full text without truncation when text fits within maxChars', () => {
      expect(extractKeywordSnippet('Ngắn gọn vừa đủ', ['vừa'], 50)).toEqual({
        text: 'Ngắn gọn vừa đủ',
        truncated: false,
      });
    });

    it('centers excerpt around longest distinctive match with ellipses', () => {
      const longText = `${'A'.repeat(120)} MÃ_ĐƠN_ORD-7789 chi tiết giao nhận ${'B'.repeat(150)}`;
      const res = extractKeywordSnippet(longText, ['mã', 'ord-7789'], 80);

      expect(res.truncated).toBe(true);
      expect(res.text).toContain('MÃ_ĐƠN_ORD-7789');
      expect(res.text.startsWith('...')).toBe(true);
      expect(res.text.endsWith('...')).toBe(true);
      expect(res.text.length).toBeLessThanOrEqual(86);
    });

    it('falls back to leading slice when no keyword matches', () => {
      const longText = 'X'.repeat(100);
      expect(extractKeywordSnippet(longText, ['khong-khop'], 20)).toEqual({
        text: `${'X'.repeat(20)}...`,
        truncated: true,
      });
    });

    it('returns empty string for non-positive maxChars', () => {
      expect(extractKeywordSnippet('abc', ['a'], 0)).toEqual({
        text: '',
        truncated: true,
      });
    });
  });
});
