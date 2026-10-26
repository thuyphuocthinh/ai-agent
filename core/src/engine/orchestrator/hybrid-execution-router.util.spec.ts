import {
  decideExecutionMode,
  EExecutionMode,
} from './hybrid-execution-router.util';

describe('HybridExecutionRouter', () => {
  describe('Default routing (Single Agent ReAct)', () => {
    it('routes standard cross-provider data queries to SINGLE_AGENT', () => {
      const decision = decideExecutionMode({
        prompt:
          'Kiểm tra danh sách đơn hàng gần đây trong database SQL và gửi thông báo cập nhật vào kênh Slack #sales',
      });

      expect(decision.mode).toBe(EExecutionMode.SINGLE_AGENT);
      expect(decision.reason).toContain('Định tuyến mặc định: Multi-Provider Single Agent');
    });

    it('routes single-tool lookup to SINGLE_AGENT', () => {
      const decision = decideExecutionMode({
        prompt: 'Đọc giúp tôi bảng giá nhà cung cấp trong Google Sheets',
      });

      expect(decision.mode).toBe(EExecutionMode.SINGLE_AGENT);
    });

    it('routes customer inquiry and email check to SINGLE_AGENT', () => {
      const decision = decideExecutionMode({
        prompt:
          'Khách hàng Bình vừa gửi email khiếu nại, hãy kiểm tra email rồi tra cứu database xem trạng thái đơn',
      });

      expect(decision.mode).toBe(EExecutionMode.SINGLE_AGENT);
    });
  });

  describe('Parallel Fan-out Trigger (Condition 1)', () => {
    it('routes to MULTI_AGENT_SUPERVISOR when prompt requests simultaneous scan', () => {
      const decision = decideExecutionMode({
        prompt: 'Quét đồng thời 5 kênh Slack #dev, #ops, #sales để tìm từ khóa sự cố thanh toán',
      });

      expect(decision.mode).toBe(EExecutionMode.MULTI_AGENT_SUPERVISOR);
      expect(decision.reason).toContain('Parallel Fan-out');
    });

    it('routes to MULTI_AGENT_SUPERVISOR when prompt requests parallel comparison across multiple targets', () => {
      const decision = decideExecutionMode({
        prompt: 'Kiểm tra cùng lúc trên 4 sàn Shopee, Tiki, Lazada xem mặt hàng này bên nào rẻ nhất',
      });

      expect(decision.mode).toBe(EExecutionMode.MULTI_AGENT_SUPERVISOR);
      expect(decision.reason).toContain('Parallel Fan-out');
    });
  });

  describe('Untrusted Code Sandbox Trigger (Condition 2)', () => {
    it('routes to MULTI_AGENT_SUPERVISOR when executing Python scripts', () => {
      const decision = decideExecutionMode({
        prompt: 'Hãy chạy script python sau để vẽ biểu đồ phân phối độ trễ API và lưu ra file ảnh',
      });

      expect(decision.mode).toBe(EExecutionMode.MULTI_AGENT_SUPERVISOR);
      expect(decision.reason).toContain('Sandbox compute');
    });

    it('routes to MULTI_AGENT_SUPERVISOR when running bash scripts', () => {
      const decision = decideExecutionMode({
        prompt: 'Thực thi mã bash để kiểm tra dung lượng ổ đĩa của server',
      });

      expect(decision.mode).toBe(EExecutionMode.MULTI_AGENT_SUPERVISOR);
      expect(decision.reason).toContain('Sandbox compute');
    });
  });

  describe('Context / Document Overflow Trigger (Condition 3)', () => {
    it('routes to MULTI_AGENT_SUPERVISOR when prompt exceeds char threshold', () => {
      const longPrompt = 'A'.repeat(30005);
      const decision = decideExecutionMode({
        prompt: longPrompt,
      });

      expect(decision.mode).toBe(EExecutionMode.MULTI_AGENT_SUPERVISOR);
      expect(decision.reason).toContain('Ngữ cảnh vượt ngưỡng an toàn');
    });

    it('routes to MULTI_AGENT_SUPERVISOR when context estimate exceeds threshold', () => {
      const decision = decideExecutionMode({
        prompt: 'Tóm tắt sự cố',
        contextCharBudgetEstimate: 35000,
      });

      expect(decision.mode).toBe(EExecutionMode.MULTI_AGENT_SUPERVISOR);
      expect(decision.reason).toContain('Ngữ cảnh vượt ngưỡng an toàn');
    });
  });

  describe('Adversarial Roles Trigger (Condition 4)', () => {
    it('routes to MULTI_AGENT_SUPERVISOR when conflicting personas are requested', () => {
      const decision = decideExecutionMode({
        prompt:
          'Đóng vai 2 bên tranh luận: bên red-team tấn công và bên blue-team phòng thủ để phản biện chéo phương án bảo mật',
      });

      expect(decision.mode).toBe(EExecutionMode.MULTI_AGENT_SUPERVISOR);
      expect(decision.reason).toContain('Red-Team vs Blue-Team');
    });
  });

  describe('Forced Mode Overrides', () => {
    it('forces SINGLE_AGENT when forcedMode is "single"', () => {
      const decision = decideExecutionMode({
        prompt: 'Quét đồng thời 5 kênh Slack',
        forcedMode: 'single',
      });

      expect(decision.mode).toBe(EExecutionMode.SINGLE_AGENT);
      expect(decision.reason).toContain('forcedMode=single');
    });

    it('forces MULTI_AGENT_SUPERVISOR when forcedMode is "supervisor"', () => {
      const decision = decideExecutionMode({
        prompt: 'Chào bot, cho xem danh sách sản phẩm',
        forcedMode: 'supervisor',
      });

      expect(decision.mode).toBe(EExecutionMode.MULTI_AGENT_SUPERVISOR);
      expect(decision.reason).toContain('forcedMode=supervisor');
    });
  });
});
