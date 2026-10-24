/**
 * Pure Utility trích xuất và chuẩn hóa số tiền (monetary amount)
 * từ các tham số gọi Tool độc lập với tên trường (amount, requestedAmount, refundAmount)
 * hoặc trích xuất trực tiếp từ văn bản prompt khi chạy ở Intent Gate.
 */
export function extractMonetaryAmount(
  args: Record<string, unknown> = {},
  fallbackText?: string,
): number {
  const candidate =
    args.amount ??
    args.requestedAmount ??
    args.refundAmount ??
    args.totalAmount ??
    args.price ??
    0;

  if (typeof candidate === 'number' && !Number.isNaN(candidate) && candidate > 0) {
    return candidate;
  }

  if (typeof candidate === 'string') {
    const cleaned = candidate.replace(/[^\d.-]/g, '');
    const parsed = Number(cleaned);
    if (!Number.isNaN(parsed) && parsed > 0) return parsed;
  }

  if (fallbackText) {
    const match =
      fallbackText.match(/(?:tiền|hoàn|số tiền|giá)\s*(?:là)?\s*([0-9][0-9.,]*)\s*(?:vnđ|đ|vnd)?/i) ||
      fallbackText.match(/([0-9][0-9.,]{4,})\s*(?:vnđ|đ|vnd)?/i);
    if (match?.[1]) {
      const cleaned = match[1].replace(/[.,]/g, '');
      const parsed = Number(cleaned);
      if (!Number.isNaN(parsed) && parsed > 0) return parsed;
    }
  }

  return 0;
}
