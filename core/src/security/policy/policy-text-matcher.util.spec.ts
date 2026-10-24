import {
  tokenizeText,
  hasForbiddenKeyword,
  calculateTokenOverlapScore,
} from './policy-text-matcher.util';

describe('policy-text-matcher.util', () => {
  describe('tokenizeText', () => {
    it('splits text into normalized lowercase tokens ignoring symbols', () => {
      const tokens = tokenizeText('DROP TABLE customers; -- danger!');
      expect(tokens).toEqual(['drop', 'table', 'customers', 'danger']);
    });

    it('handles Vietnamese accents correctly', () => {
      const tokens = tokenizeText('Bảng lương nhân viên tháng 10!');
      expect(tokens).toEqual(['bảng', 'lương', 'nhân', 'viên', 'tháng', '10']);
    });

    it('returns empty array for empty or null text', () => {
      expect(tokenizeText('')).toEqual([]);
    });
  });

  describe('hasForbiddenKeyword', () => {
    it('returns true when a forbidden keyword matches case-insensitively', () => {
      expect(hasForbiddenKeyword('DROP table users', ['DROP TABLE', 'TRUNCATE'])).toBe(true);
      expect(hasForbiddenKeyword('Xem bảng LƯƠNG kế toán', ['bảng lương', 'salary'])).toBe(true);
    });

    it('returns false when no keyword matches', () => {
      expect(hasForbiddenKeyword('SELECT * FROM products', ['DROP TABLE', 'TRUNCATE'])).toBe(false);
    });
  });

  describe('calculateTokenOverlapScore', () => {
    it('awards high score when forbidden keyword is matched', () => {
      const score = calculateTokenOverlapScore(
        'DROP TABLE orders',
        'Cấm xóa CSDL',
        'Không được chạy lệnh DROP TABLE trên production',
        ['DROP TABLE'],
      );
      expect(score).toBeGreaterThanOrEqual(0.85);
    });

    it('calculates proportional score based on matching tokens', () => {
      const score = calculateTokenOverlapScore(
        'hoàn tiền đơn hàng',
        'Chính sách hoàn tiền',
        'Nội dung hoàn tiền đơn hàng cho khách',
      );
      expect(score).toBeGreaterThan(0.4);
    });

    it('returns 0 for completely unrelated queries', () => {
      const score = calculateTokenOverlapScore(
        'thời tiết hôm nay',
        'Bảo mật hạ tầng mạng',
        'Cấu hình firewall và VPN',
      );
      expect(score).toBe(0);
    });
  });
});
