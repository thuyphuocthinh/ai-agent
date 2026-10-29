import {
  buildDelegationPrompt,
  buildGuardrailBlockedResult,
  buildPartialStepTask,
  buildReplanRoundResult,
  buildUnknownAgentAnswer,
} from './turn-resolver-prompt.util';

// Chuỗi mong đợi được copy NGUYÊN VĂN từ turn-resolver-run.ts trước khi chuyển.
describe('turn resolver prompt builders (golden)', () => {
  it('marks a round as re-planned', () => {
    expect(buildReplanRoundResult()).toBe(
      '[re-plan] evaluate() cho rằng bước vừa xong không đạt kỳ vọng, đã lập lại kế hoạch.',
    );
  });

  it('marks a round blocked by the misroute guardrail', () => {
    expect(buildGuardrailBlockedResult('slack', 'SQL Server', 'sql_server')).toBe(
      'Bỏ qua bước này — kế hoạch chọn hệ thống "slack" nhưng yêu cầu nhắc rõ tới hệ thống "SQL Server" (đã kết nối, provider "sql_server") — có khả năng chọn sai agent, cần lập lại kế hoạch.',
    );
  });

  it('answers when the plan only names unknown agents', () => {
    expect(buildUnknownAgentAnswer('foo, bar')).toBe(
      'Mình chưa thể xử lý yêu cầu này với các kết nối hiện có (Tên hệ thống mà AI đang cố gọi: "foo, bar" - Vui lòng đổi tên hoặc viết đúng tên). Vào Settings để kết nối agent phù hợp nhé.',
    );
  });

  it('describes the partial data collected before an approval was needed', () => {
    expect(buildPartialStepTask('đếm đơn')).toBe(
      'đếm đơn (dữ liệu đã thu thập được TRƯỚC KHI cần duyệt 1 hành động khác trong cùng bước này)',
    );
  });

  describe('buildDelegationPrompt', () => {
    it('is just the task when it equals the original prompt and there are no prior rounds', () => {
      expect(
        buildDelegationPrompt({
          task: 'đếm đơn',
          originalPrompt: 'đếm đơn',
          limitScope: false,
          priorRounds: [],
        }),
      ).toBe('đếm đơn');
    });

    it('adds the full original request when the task is a summary of it', () => {
      expect(
        buildDelegationPrompt({
          task: 'đếm đơn',
          originalPrompt: 'đếm đơn rồi gửi Slack',
          limitScope: false,
          priorRounds: [],
        }),
      ).toBe(
        'đếm đơn\n\n' +
          'Yêu cầu gốc đầy đủ của user cho turn này (dùng để lấy đúng dữ liệu/số liệu cụ thể nếu task ở trên chỉ tóm tắt lại, TUYỆT ĐỐI không tự bịa dữ liệu khi task tóm tắt bị thiếu).\n' +
          'đếm đơn rồi gửi Slack',
      );
    });

    it('limits the worker to its own task when other steps remain', () => {
      expect(
        buildDelegationPrompt({
          task: 'đếm đơn',
          originalPrompt: 'đếm đơn rồi gửi Slack',
          limitScope: true,
          priorRounds: [],
        }),
      ).toBe(
        'đếm đơn\n\n' +
          'Yêu cầu gốc đầy đủ của user cho turn này (dùng để lấy đúng dữ liệu/số liệu cụ thể nếu task ở trên chỉ tóm tắt lại, TUYỆT ĐỐI không tự bịa dữ liệu khi task tóm tắt bị thiếu). ' +
          'CHỈ thực hiện phần việc trong task ở trên; các phần khác của yêu cầu gốc là việc của CÁC BƯỚC KHÁC trong kế hoạch — KHÔNG làm thay, KHÔNG gọi tool cho phần đó.\n' +
          'đếm đơn rồi gửi Slack',
      );
    });

    it('appends the REAL data of the prior rounds, numbered', () => {
      expect(
        buildDelegationPrompt({
          task: 'gửi Slack',
          originalPrompt: 'gửi Slack',
          limitScope: true,
          priorRounds: [
            { agent: 'sql_server', task: 'đếm đơn', result: '42' },
            { agent: 'notion', task: 'lấy tên', result: 'Roadmap' },
          ],
        }),
      ).toBe(
        'gửi Slack\n\n' +
          'Dữ liệu THẬT đã thu thập được từ (các) bước trước trong CÙNG yêu cầu này (PHẢI dùng ĐÚNG NGUYÊN VĂN, không tự bịa/diễn giải lại số liệu):\n' +
          '1. Agent "sql_server" (yêu cầu: "đếm đơn") → kết quả: 42\n' +
          '2. Agent "notion" (yêu cầu: "lấy tên") → kết quả: Roadmap',
      );
    });

    it('orders the blocks: task, original request, prior rounds', () => {
      const prompt = buildDelegationPrompt({
        task: 'bước 2',
        originalPrompt: 'yêu cầu gốc',
        limitScope: true,
        priorRounds: [{ agent: 'a', task: 't', result: 'r' }],
      });

      expect(prompt.indexOf('bước 2')).toBe(0);
      expect(prompt.indexOf('Yêu cầu gốc đầy đủ')).toBeLessThan(prompt.indexOf('Dữ liệu THẬT'));
    });
  });
});
