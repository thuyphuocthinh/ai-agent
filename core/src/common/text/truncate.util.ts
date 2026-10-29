// Gộp mọi khoảng trắng/xuống dòng thành một dòng rồi cắt còn tối đa `maxChars`
// ký tự (thêm "…" khi bị cắt) — dùng cho đoạn mô tả ngắn đưa vào prompt.
export function truncateToSingleLine(text: string, maxChars: number): string {
  const singleLine = text.replace(/\s+/g, ' ').trim();
  return singleLine.length > maxChars
    ? `${singleLine.slice(0, maxChars - 1)}…`
    : singleLine;
}
