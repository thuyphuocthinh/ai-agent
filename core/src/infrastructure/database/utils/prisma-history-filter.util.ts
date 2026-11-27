export function isEligibleHistoryMessage(text: string): boolean {
  if (
    text.startsWith('⏸️') ||
    text.includes('Cần bạn duyệt') ||
    text.includes('Cần bạn làm rõ')
  ) {
    return false;
  }
  return true;
}
