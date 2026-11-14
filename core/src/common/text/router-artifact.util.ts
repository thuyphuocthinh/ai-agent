/**
 * 9Router (hoặc reverse proxy AI tương tự) đôi khi gắn nhầm terminator
 * SSE "data: [DONE]" vào cuối 1 response JSON bình thường (không streaming),
 * hoặc double-stringify cả body payload.
 *
 * Chuỗi "[DONE]" tự chứa ký tự `[`/`]` nên bộ dò ngoặc của JsonExtractor
 * dễ nhận nhầm nó là 1 phần cấu trúc JSON — tiện ích này dọn dẹp rác này
 * trước khi đưa vào parse/extract.
 */
export function stripNineRouterArtifacts(rawText: string): string {
  let text = rawText.replace(/data:\s*\[DONE\]\s*$/g, '').trim();

  try {
    const parsed = JSON.parse(text);
    if (typeof parsed === 'string') {
      text = parsed;
    }
  } catch {
    // Không phải double-stringified, giữ nguyên text.
  }

  return text;
}
