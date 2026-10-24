/**
 * Pure Utility xử lý chuẩn hóa chuỗi và tính toán độ tương đồng từ khóa
 * cho Policy Corpus và Semantic Evaluator.
 */

/**
 * Tách chuỗi thành danh sách các token từ vựng hợp lệ (loại bỏ ký tự đặc biệt, dấu câu).
 */
export function tokenizeText(text: string): string[] {
  if (!text) return [];

  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((token) => token.length > 1);
}

/**
 * Kiểm tra xem chuỗi có chứa bất kỳ từ khóa cấm nào hay không (không phân biệt hoa thường).
 */
export function hasForbiddenKeyword(
  text: string,
  forbiddenKeywords: string[] = [],
): boolean {
  if (!text || forbiddenKeywords.length === 0) return false;

  const normalized = text.toLowerCase();
  return forbiddenKeywords.some((keyword) =>
    normalized.includes(keyword.toLowerCase()),
  );
}

/**
 * Tính toán điểm số tương đồng token overlap giữa truy vấn và tài liệu chính sách.
 * Trả về giá trị trong khoảng [0, 1].
 */
export function calculateTokenOverlapScore(
  query: string,
  title: string,
  content: string,
  forbiddenKeywords: string[] = [],
): number {
  if (!query) return 0;

  const queryLower = query.toLowerCase();
  let score = 0;

  // Điểm cộng lớn nếu khớp trực tiếp từ khóa quan trọng/từ khóa cấm
  if (hasForbiddenKeyword(queryLower, forbiddenKeywords)) {
    score += 0.85;
  }

  const queryTokens = new Set(tokenizeText(query));
  if (queryTokens.size === 0) {
    return Math.min(1, Math.max(0, score));
  }

  const titleLower = title.toLowerCase();
  const contentLower = content.toLowerCase();

  let matchedTokens = 0;
  for (const token of queryTokens) {
    if (titleLower.includes(token)) {
      matchedTokens += 1.5;
    } else if (contentLower.includes(token)) {
      matchedTokens += 1.0;
    }
  }

  score += Math.min(0.7, matchedTokens / (queryTokens.size * 1.5));

  return Math.min(1, Math.max(0, score));
}
