import { DEFAULT_AGGREGATOR_SYSTEM_PROMPT } from '../../../../constants/prompts';
import {
  buildAggregatorNoSuccessMessage,
  buildFanoutAllFailedAnswer,
  buildIsolatedSubAgentPrompt,
  buildSubAgentFailureResult,
  buildApprovalFollowUpPrompt,
  buildApprovedToolFailureMessage,
  buildClarifiedPrompt,
} from './engine-prompt.util';

// Chuỗi mong đợi được copy NGUYÊN VĂN từ single-agent.engine.ts / pipeline-chaining.engine.ts
// trước khi chuyển.
describe('engine prompts (golden)', () => {
  it('keeps the default aggregator system prompt unchanged', () => {
    expect(DEFAULT_AGGREGATOR_SYSTEM_PROMPT).toBe(
      'Bạn là chuyên gia tổng hợp thông tin đa nguồn. Dựa trên kết quả thu thập được từ nhiều nguồn độc lập, hãy tổng hợp, so sánh và trình bày một báo cáo hoàn chỉnh, có cấu trúc rõ ràng và khách quan nhất.',
    );
  });

  it('lists every failed worker when all of them failed', () => {
    expect(
      buildFanoutAllFailedAnswer([
        { workerName: 'SQL', error: 'timeout' },
        { workerName: 'Slack' },
      ]),
    ).toBe(
      '⚠️ Không thể tổng hợp dữ liệu (không thể cung cấp kết quả) do toàn bộ nguồn worker đều gặp sự cố:\n- SQL: timeout\n- Slack: Lỗi không xác định',
    );
  });

  it('tells that every source failed when the aggregator has nothing to merge', () => {
    expect(buildAggregatorNoSuccessMessage(3)).toBe(
      'Tất cả 3 nguồn dữ liệu đều gặp lỗi và không thể cung cấp kết quả. Vui lòng thử lại sau.',
    );
  });

  it('wraps the context and the task for an isolated sub-agent', () => {
    expect(buildIsolatedSubAgentPrompt('dữ liệu A', 'làm B')).toBe(
      '=== DỮ LIỆU CUNG CẤP TỪ AGENT CHÍNH ===\ndữ liệu A\n\n=== NHIỆM VỤ CẦN THỰC HIỆN ===\nlàm B',
    );
  });

  it('is just the task when the sub-agent has no context', () => {
    expect(buildIsolatedSubAgentPrompt(undefined, 'làm B')).toBe('làm B');
    expect(buildIsolatedSubAgentPrompt('', 'làm B')).toBe('làm B');
  });

  it('reports why a sub-agent could not finish', () => {
    expect(buildSubAgentFailureResult('boom')).toBe(
      'Sub-agent không thể hoàn thành nhiệm vụ do lỗi: boom',
    );
  });

  it('reports an approved tool that failed at resume', () => {
    expect(buildApprovedToolFailureMessage('execute_write_query', 'insufficient permission')).toBe(
      '⚠️ Hành động "execute_write_query" đã được duyệt nhưng thực thi thất bại:\ninsufficient permission',
    );
  });

  it('appends the chosen candidate to the original prompt', () => {
    expect(buildClarifiedPrompt('Lưu thông tin', 'Notion', 'notion')).toBe(
      'Lưu thông tin\n\n[Khách hàng được chọn: Notion (Mã: notion)]',
    );
  });

  it('keeps the literal "undefined" when there is no candidate id (existing behaviour)', () => {
    expect(buildClarifiedPrompt('Lưu', 'Đã xác nhận', undefined)).toBe(
      'Lưu\n\n[Khách hàng được chọn: Đã xác nhận (Mã: undefined)]',
    );
  });

  describe('buildApprovalFollowUpPrompt', () => {
    const input = {
      originalPrompt: 'Tạo 5 sản phẩm rồi báo Slack',
      provider: 'sql_server',
      toolName: 'execute_write_query',
      resultText: 'Đã thêm 5 dòng',
    };

    it('builds the progress context and the continuation instructions', () => {
      expect(buildApprovalFollowUpPrompt(input)).toBe(
        '[BỐI CẢNH TIẾN ĐỘ THỰC THI]:\n' +
          '- Yêu cầu gốc: "Tạo 5 sản phẩm rồi báo Slack"\n' +
          '- Hành động rủi ro "sql_server.execute_write_query" ĐÃ ĐƯỢC NGƯỜI DÙNG PHÊ DUYỆT VÀ ĐÃ THỰC THI THÀNH CÔNG trên hệ thống.\n' +
          '- Kết quả thực thi thực tế: Đã thêm 5 dòng\n' +
          '\n' +
          '[CHỈ DẪN TIẾP TỤC]:\n' +
          '1. TUYỆT ĐỐI KHÔNG gọi lại hành động "execute_write_query" hoặc các bước đã hoàn tất trước đó (dữ liệu đã được ghi nhận trên hệ thống).\n' +
          '2. Nếu trong yêu cầu ban đầu CÒN BƯỚC TIẾP THEO (ví dụ: gửi thông báo Slack/Email, tổng hợp thêm...), hãy tiếp tục sử dụng công cụ phù hợp để hoàn tất.\n' +
          '3. Nếu TẤT CẢ CÁC BƯỚC ĐÃ XONG, hãy viết câu trả lời hoàn chỉnh để báo cáo kết quả cho người dùng.',
      );
    });

    it('cuts the tool result to 1500 characters', () => {
      const prompt = buildApprovalFollowUpPrompt({ ...input, resultText: 'x'.repeat(2000) });

      expect(prompt).toContain(`- Kết quả thực thi thực tế: ${'x'.repeat(1500)}\n`);
      expect(prompt).not.toContain('x'.repeat(1501));
    });
  });
});
