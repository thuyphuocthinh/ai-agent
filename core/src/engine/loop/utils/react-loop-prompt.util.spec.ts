import {
  buildEscalationDetail,
  buildIdempotencyBlockedMessage,
  buildInsertShortfallMessage,
  buildMergedSqlBatchResult,
  buildRepeatedToolCallMessage,
  buildMaxStepsAnswer,
  buildPolicyGroundingPrompt,
  buildQuantityMismatchAnswer,
  buildQuantityNudgePrompt,
  buildResourcesPrompt,
  formatResourceBlock,
} from './react-loop-prompt.util';

// Chuỗi mong đợi được copy NGUYÊN VĂN từ code trước khi chuyển (react-loop.service.ts),
// để chứng minh việc chuyển prompt không đổi một ký tự nào.
describe('react-loop prompt builders (golden)', () => {
  describe('formatResourceBlock', () => {
    it('wraps the content under a titled separator', () => {
      expect(formatResourceBlock('Database schema', 'TABLE users (id INT)')).toBe(
        '\n--- Resource: Database schema ---\nTABLE users (id INT)',
      );
    });
  });

  describe('buildResourcesPrompt', () => {
    it('is empty when there is no resource', () => {
      expect(buildResourcesPrompt([])).toBe('');
    });

    it('ignores empty blocks (resources that failed to load)', () => {
      expect(buildResourcesPrompt(['', ''])).toBe('');
    });

    it('appends the header and the non-empty blocks separated by a newline', () => {
      expect(buildResourcesPrompt(['\n--- Resource: A ---\naaa', '', '\n--- Resource: B ---\nbbb'])).toBe(
        '\n\nBạn có sẵn các Context/Resources sau trong bộ nhớ để tham khảo, tuyệt đối ưu tiên sử dụng thông tin này nếu liên quan đến câu hỏi của người dùng:\n' +
          '\n--- Resource: A ---\naaa\n\n--- Resource: B ---\nbbb',
      );
    });
  });

  describe('tool-call guard messages', () => {
    it('describes an escalation with the amount and the AI limit', () => {
      expect(buildEscalationDetail('finance.issue_refund', 700000, 500000)).toBe(
        'Thao tác finance.issue_refund yêu cầu số tiền 700000 vượt hạn mức AI (500000)',
      );
    });

    it('shows N/A when the amount or the limit is unknown', () => {
      expect(buildEscalationDetail('x', undefined, undefined)).toBe(
        'Thao tác x yêu cầu số tiền N/A vượt hạn mức AI (N/A)',
      );
    });

    it('reports an idempotency lock with its reason', () => {
      expect(buildIdempotencyBlockedMessage('đang xử lý')).toBe(
        '[Idempotency] Thao tác đang được xử lý hoặc đã hoàn tất trước đó (đang xử lý).',
      );
    });

    it('suggests the other tools when blocking a repeated call', () => {
      expect(buildRepeatedToolCallMessage('read_query', 3, ['execute_write_query', 'table_schema'])).toBe(
        'Tool "read_query" đã được gọi với ĐÚNG tham số này 2 lần trước đó và không thực thi lại nữa. ' +
          'KHÔNG được gọi lại tool này. Nếu nhiệm vụ cần 1 HÀNH ĐỘNG (ghi/thêm/tạo/sửa dữ liệu...), hãy gọi tool phù hợp trong số các tool còn lại: execute_write_query, table_schema. ' +
          'Nếu không có tool nào phù hợp để hoàn thành yêu cầu, báo thẳng cho người dùng biết giới hạn đó thay vì im lặng bỏ cuộc.',
      );
    });

    it('says there is no other tool when the list is empty', () => {
      expect(buildRepeatedToolCallMessage('read_query', 3, [])).toBe(
        'Tool "read_query" đã được gọi với ĐÚNG tham số này 2 lần trước đó và không thực thi lại nữa. ' +
          'Không còn tool nào khác của hệ thống này để thử. ' +
          'Nếu không có tool nào phù hợp để hoàn thành yêu cầu, báo thẳng cho người dùng biết giới hạn đó thay vì im lặng bỏ cuộc.',
      );
    });

    it('asks for the missing INSERT rows', () => {
      expect(buildInsertShortfallMessage(3, 5)).toBe(
        'Đã ghi nhận 3/5 dòng yêu cầu (cộng dồn qua các lần gọi trước nếu có). Viết tiếp các dòng CÒN THIẾU (không lặp lại dòng đã gửi) trong 1 câu ghi duy nhất, rồi gọi lại.',
      );
    });
  });

  describe('quantity prompts', () => {
    it('builds the nudge that asks the model to continue with the missing part', () => {
      expect(buildQuantityNudgePrompt(5, 3)).toBe(
        'Yêu cầu cần xử lý đúng 5 bản ghi, nhưng theo kết quả tool hiện tại mới có 3. Hãy tiếp tục thực hiện phần còn thiếu trước khi trả lời.',
      );
    });

    it('builds the final answer with the REAL achieved count appended', () => {
      expect(buildQuantityMismatchAnswer('Đã xong', 5, 3)).toBe(
        'Đã xong\n\n⚠️ Yêu cầu cần xử lý đúng 5, nhưng theo kết quả tool THẬT chỉ xác nhận được 3.',
      );
    });
  });

  describe('buildMaxStepsAnswer', () => {
    it('falls back to the default message when the model said nothing', () => {
      expect(buildMaxStepsAnswer('', false)).toBe(
        'Xin lỗi, câu hỏi này cần nhiều bước hơn mình hỗ trợ được.',
      );
    });

    it('keeps the model text when there is one', () => {
      expect(buildMaxStepsAnswer('Câu trả lời dở', false)).toBe('Câu trả lời dở');
    });

    it('appends the partial-write caveat (with its leading space) after a successful tool call', () => {
      expect(buildMaxStepsAnswer('Câu trả lời dở', true)).toBe(
        'Câu trả lời dở Một số hành động (đọc/ghi dữ liệu) đã thực hiện THÀNH CÔNG trước khi dừng — kiểm tra lại kết quả hiện có trước khi yêu cầu lại, tránh lặp lại đúng thao tác đã làm.',
      );
    });
  });

  describe('buildPolicyGroundingPrompt', () => {
    it('is empty when there is no relevant policy', () => {
      expect(buildPolicyGroundingPrompt([])).toBe('');
    });

    it('renders the policies followed by the enforcement principle', () => {
      const text = buildPolicyGroundingPrompt([
        { id: 'SEC-1', title: 'Cấm xuất dữ liệu', content: 'Không xuất dữ liệu khách hàng.' },
        { id: 'SEC-2', title: 'Phê duyệt', content: 'Cần quản lý duyệt.' },
      ]);

      expect(text).toBe(
        '\n\n--- QUY CHẾ DOANH NGHIỆP BẮT BUỘC (ENTERPRISE POLICIES) ---\n' +
          'Các quy chế sau đây áp dụng trực tiếp cho yêu cầu của người dùng:\n\n' +
          '- [SEC-1] Cấm xuất dữ liệu:\n  Không xuất dữ liệu khách hàng.\n\n' +
          '- [SEC-2] Phê duyệt:\n  Cần quản lý duyệt.\n\n' +
          'NGUYÊN TẮC THI HÀNH BẮT BUỘC:\n' +
          'Nếu yêu cầu của người dùng thuộc phạm vi cần phê duyệt (REQUIRE_APPROVAL) hoặc bị nghiêm cấm (DENY), ' +
          'bạn TUYỆT ĐỐI KHÔNG ĐƯỢC tự ý sinh script, file cấu hình (YAML, JSON), hoặc viết hướng dẫn chi tiết để người dùng tự làm thủ công nhằm lách quy chế. ' +
          'Hãy thông báo rõ ràng về điều khoản quy định và hướng dẫn người dùng xin phê duyệt từ cấp quản lý có thẩm quyền.',
      );
    });
  });

  describe('merged SQL batch result', () => {
    it('points the merged INSERT calls to the primary call', () => {
      expect(buildMergedSqlBatchResult('call_1')).toBe(
        'Merged into the SQL batch represented by tool call call_1; no separate database execution and no additional rows were affected.',
      );
    });
  });
});
