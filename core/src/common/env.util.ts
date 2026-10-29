// Parse giá trị biến môi trường dạng chuỗi: bỏ trống hoặc không hợp lệ thì dùng
// `fallback` thay vì ném lỗi, để cấu hình sai không làm hỏng lượt chạy.

export function parseBooleanEnv(
  raw: string | undefined,
  fallback: boolean,
): boolean {
  const value = raw?.trim().toLowerCase();
  if (value === 'false' || value === '0') return false;
  if (value === 'true' || value === '1') return true;
  return fallback;
}

export function parseNumberEnv(
  raw: string | undefined,
  fallback: number,
  isValid: (value: number) => boolean,
): number {
  if (raw === undefined || raw.trim() === '') return fallback;
  const value = Number(raw);
  return Number.isFinite(value) && isValid(value) ? value : fallback;
}

export function parsePositiveIntEnv(
  raw: string | undefined,
  fallback: number,
): number {
  return parseNumberEnv(raw, fallback, (v) => Number.isInteger(v) && v > 0);
}
