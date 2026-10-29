import { CONTINUATION_TASK_MARKER } from '../../../constants/prompts';

// Thông điệp hiển thị cho người dùng/đưa vào kết quả của luồng HITL: hàm thuần, dữ liệu thuần.

// Tóm tắt rủi ro khi sắp xoá/hủy CẢ bảng (TRUNCATE/DROP): số dòng không còn ý nghĩa.
export function buildWholeTableDestructivePreview(
  table: string,
  operation: string,
  isTruncate: boolean,
): string {
  const verb = isTruncate ? 'XOÁ TOÀN BỘ DỮ LIỆU' : 'XOÁ HẲN';
  return `⚠️ Sẽ ${verb} bảng "${table}" (${operation} — KHÔNG THỂ khôi phục).`;
}

export function buildInsertRowsPreview(
  rowCount: number,
  table: string,
  isMaximum: boolean,
): string {
  return isMaximum
    ? `Sẽ thêm tối đa ~${rowCount} dòng mới vào bảng "${table}".`
    : `Sẽ thêm ~${rowCount} dòng mới vào bảng "${table}".`;
}

// UPDATE/DELETE trên dòng có sẵn: cảnh báo riêng khi thiếu mệnh đề WHERE (ảnh hưởng cả bảng).
export function buildExistingRowsPreview(
  affectedCount: number,
  hasWhereClause: boolean,
): string {
  return hasWhereClause
    ? `Sẽ ảnh hưởng ~${affectedCount} dòng.`
    : `⚠️ Câu lệnh KHÔNG có mệnh đề WHERE — sẽ ảnh hưởng TOÀN BỘ bảng (~${affectedCount} dòng).`;
}

// Fallback tổng quát: hiện nguyên tham số thật sẽ gửi đi (đã cắt gọn ở nơi gọi).
export function buildGenericArgsPreview(
  provider: string,
  toolName: string,
  argsText: string,
): string {
  return `Sẽ gọi "${provider}.${toolName}" với tham số:\n${argsText}\n\nKhông ước lượng được mức độ ảnh hưởng cụ thể — kiểm tra kỹ tham số trên trước khi duyệt.`;
}

// Task gốc của một bước "làm tiếp" (bỏ phần ghi chú tiến độ nối sau marker).
export function getRootTask(task: string): string {
  return task.split(CONTINUATION_TASK_MARKER)[0];
}

// Task của bước "làm tiếp": dặn làm nốt phần còn thiếu, gộp vào đúng 1 lần gọi tool.
export function buildContinuationTask(
  pendingTask: string,
  achievedCount: number,
  requiredCount: number,
): string {
  const missing = requiredCount - achievedCount;
  return `${pendingTask}${CONTINUATION_TASK_MARKER} ${achievedCount}/${requiredCount} — làm tiếp ${missing} phần còn thiếu, không lặp lại phần đã xong. Nếu tool cho phép nhiều bản ghi trong 1 lần gọi, hãy gộp TOÀN BỘ ${missing} phần còn thiếu vào ĐÚNG 1 lần gọi tool duy nhất — mỗi lần cần duyệt lại tốn thêm 1 vòng chờ user, không chia nhỏ thêm nữa.)`;
}

// Ghi chú nối vào kết quả khi đã thử đủ số lần mà số lượng vẫn thiếu: dừng, báo rõ cho user.
export function buildQuantityCapReachedResult(
  toolResultText: string,
  requiredCount: number,
  achievedCount: number,
  attempts: number,
): string {
  return `${toolResultText}\n\n[Lưu ý: yêu cầu cần ${requiredCount}, mới xử lý được ${achievedCount} sau ${attempts} lần thử — đã dừng lại, KHÔNG tự động thử thêm.]`;
}
