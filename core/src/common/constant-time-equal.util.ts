import { createHash, timingSafeEqual } from 'node:crypto';

// So sánh bí mật (API key, token) theo thời gian hằng: băm SHA-256 trước để hai
// chuỗi luôn cùng độ dài (timingSafeEqual yêu cầu) và không lộ độ dài qua thời gian.
export function constantTimeEqual(a: string, b: string): boolean {
  const digest = (value: string) => createHash('sha256').update(value).digest();
  return timingSafeEqual(digest(a), digest(b));
}
