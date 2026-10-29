import {
  CONTINUATION_TASK_MARKER,
  WORKER_CRASHED_AFTER_EXECUTION_MESSAGE,
  WORKER_CRASHED_EXECUTION_UNKNOWN_MESSAGE,
} from '../../../constants/prompts';
import {
  buildContinuationTask,
  buildExistingRowsPreview,
  buildGenericArgsPreview,
  buildInsertRowsPreview,
  buildQuantityCapReachedResult,
  buildWholeTableDestructivePreview,
  getRootTask,
} from './hitl-message.util';

// Chuỗi mong đợi được copy NGUYÊN VĂN từ checkpoint-pause / checkpoint-cleanup /
// approval-continuation-planner trước khi chuyển.
describe('HITL messages (golden)', () => {
  describe('write-query risk previews', () => {
    it('warns that TRUNCATE wipes the whole table', () => {
      expect(buildWholeTableDestructivePreview('orders', 'TRUNCATE', true)).toBe(
        '⚠️ Sẽ XOÁ TOÀN BỘ DỮ LIỆU bảng "orders" (TRUNCATE — KHÔNG THỂ khôi phục).',
      );
    });

    it('warns that DROP removes the table', () => {
      expect(buildWholeTableDestructivePreview('orders', 'DROP', false)).toBe(
        '⚠️ Sẽ XOÁ HẲN bảng "orders" (DROP — KHÔNG THỂ khôi phục).',
      );
    });

    it('estimates the rows an INSERT adds (exact or at most)', () => {
      expect(buildInsertRowsPreview(5, 'products', false)).toBe(
        'Sẽ thêm ~5 dòng mới vào bảng "products".',
      );
      expect(buildInsertRowsPreview(5, 'products', true)).toBe(
        'Sẽ thêm tối đa ~5 dòng mới vào bảng "products".',
      );
    });

    it('counts the rows an UPDATE/DELETE with a WHERE clause affects', () => {
      expect(buildExistingRowsPreview(12, true)).toBe('Sẽ ảnh hưởng ~12 dòng.');
    });

    it('warns loudly when there is no WHERE clause', () => {
      expect(buildExistingRowsPreview(12, false)).toBe(
        '⚠️ Câu lệnh KHÔNG có mệnh đề WHERE — sẽ ảnh hưởng TOÀN BỘ bảng (~12 dòng).',
      );
    });

    it('shows the real arguments for any other tool', () => {
      expect(buildGenericArgsPreview('github', 'create_issue', '{\n  "title": "x"\n}')).toBe(
        'Sẽ gọi "github.create_issue" với tham số:\n{\n  "title": "x"\n}\n\nKhông ước lượng được mức độ ảnh hưởng cụ thể — kiểm tra kỹ tham số trên trước khi duyệt.',
      );
    });
  });

  describe('worker crash notices', () => {
    it('says the action already ran when toolExecutedAt was set', () => {
      expect(WORKER_CRASHED_AFTER_EXECUTION_MESSAGE).toBe(
        '⚠️ Hành động đã được duyệt và THỰC THI THÀNH CÔNG, nhưng worker gặp sự cố ngay sau đó khi tổng hợp câu trả lời. Kết quả đã được ghi — không cần thực hiện lại hành động này.',
      );
    });

    it('never claims a retry is safe when execution is unknown', () => {
      expect(WORKER_CRASHED_EXECUTION_UNKNOWN_MESSAGE).toBe(
        '⚠️ Hành động đã được duyệt nhưng worker gặp sự cố trong lúc thực thi — CHƯA THỂ XÁC ĐỊNH hành động đã thực sự chạy hay chưa. Vui lòng tự kiểm tra kết quả (VD trong hệ thống/ứng dụng đích) TRƯỚC KHI yêu cầu lại, để tránh thực hiện trùng.',
      );
    });
  });

  describe('quantity continuation', () => {
    it('keeps the marker that separates the root task from the progress note', () => {
      expect(CONTINUATION_TASK_MARKER).toBe('\n\n(Đã xử lý');
    });

    it('builds the follow-up task asking for the missing part in ONE call', () => {
      expect(buildContinuationTask('tạo 5 sản phẩm', 3, 5)).toBe(
        'tạo 5 sản phẩm\n\n(Đã xử lý 3/5 — làm tiếp 2 phần còn thiếu, không lặp lại phần đã xong. Nếu tool cho phép nhiều bản ghi trong 1 lần gọi, hãy gộp TOÀN BỘ 2 phần còn thiếu vào ĐÚNG 1 lần gọi tool duy nhất — mỗi lần cần duyệt lại tốn thêm 1 vòng chờ user, không chia nhỏ thêm nữa.)',
      );
    });

    it('recovers the root task from a follow-up task', () => {
      const followUp = buildContinuationTask('tạo 5 sản phẩm', 3, 5);

      expect(getRootTask(followUp)).toBe('tạo 5 sản phẩm');
      expect(getRootTask('tạo 5 sản phẩm')).toBe('tạo 5 sản phẩm');
    });

    it('notes that the quantity is still short after the attempts and that no more retries happen', () => {
      expect(buildQuantityCapReachedResult('kết quả', 5, 3, 2)).toBe(
        'kết quả\n\n[Lưu ý: yêu cầu cần 5, mới xử lý được 3 sau 2 lần thử — đã dừng lại, KHÔNG tự động thử thêm.]',
      );
    });
  });
});
