const MAX_KEYWORDS = 10;
const MATCH_LEAD_RATIO = 0.3;
const EXACT_PHRASE_BONUS = 100;
const KEYWORD_MATCH_BASE_SCORE = 10;

/**
 * Chuẩn hóa truy vấn thành tối đa 10 từ khóa duy nhất (không phân biệt hoa thường),
 * ưu tiên giữ các từ dài/đặc trưng trước để tránh câu hỏi dài làm rơi mất thực thể chính.
 */
export function splitSearchKeywords(query?: string): string[] {
  if (!query) return [];
  const byLower = new Map<string, string>();
  for (const raw of query.trim().split(/\s+/)) {
    const token = raw.replace(/^[^\p{L}\p{N}-]+|[^\p{L}\p{N}-]+$/gu, '').trim();
    if (!token) continue;
    const key = token.toLowerCase();
    if (!byLower.has(key)) {
      byLower.set(key, token);
    }
  }
  return Array.from(byLower.values())
    .sort((a, b) => b.length - a.length)
    .slice(0, MAX_KEYWORDS);
}

/**
 * Chấm điểm mức độ liên quan của một tin nhắn theo số từ khóa khớp và cụm chính xác.
 */
export function scoreHistoryMatch(
  text: string,
  rawQuery: string | undefined,
  keywords: readonly string[],
): { matchedCount: number; score: number } {
  const lower = text.toLowerCase();
  const normalizedQuery = rawQuery?.trim().toLowerCase();
  let matchedCount = 0;
  let score =
    normalizedQuery && normalizedQuery.length > 0 && lower.includes(normalizedQuery)
      ? EXACT_PHRASE_BONUS
      : 0;

  for (const kw of keywords) {
    if (lower.includes(kw.toLowerCase())) {
      matchedCount += 1;
      score += KEYWORD_MATCH_BASE_SCORE + kw.length;
    }
  }
  return { matchedCount, score };
}

/**
 * Trích đoạn văn bản xoay quanh từ khóa khớp đặc trưng nhất (ưu tiên từ dài hơn trước,
 * giữ 30% trước + 70% sau), giúp câu trả lời AI dài vẫn giữ nguyên đoạn chứa thông tin cần tìm.
 */
export function extractKeywordSnippet(
  text: string,
  keywords: readonly string[],
  maxChars: number,
): { text: string; truncated: boolean } {
  if (maxChars <= 0) {
    return { text: '', truncated: text.length > 0 };
  }
  if (text.length <= maxChars) {
    return { text, truncated: false };
  }

  const lower = text.toLowerCase();
  const prioritized = [...keywords].sort((a, b) => b.length - a.length);
  let anchorIdx = -1;
  for (const kw of prioritized) {
    const idx = lower.indexOf(kw.toLowerCase());
    if (idx !== -1) {
      anchorIdx = idx;
      break;
    }
  }

  if (anchorIdx === -1) {
    return {
      text: `${text.slice(0, maxChars)}...`,
      truncated: true,
    };
  }

  const leadChars = Math.floor(maxChars * MATCH_LEAD_RATIO);
  const start = Math.max(
    0,
    Math.min(anchorIdx - leadChars, text.length - maxChars),
  );
  const end = Math.min(text.length, start + maxChars);
  const prefix = start > 0 ? '...' : '';
  const suffix = end < text.length ? '...' : '';

  return {
    text: `${prefix}${text.slice(start, end)}${suffix}`,
    truncated: start > 0 || end < text.length,
  };
}
