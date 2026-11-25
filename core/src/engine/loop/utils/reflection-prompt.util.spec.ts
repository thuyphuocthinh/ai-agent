import {
  buildToolReflectiveMessage,
  buildCriticCorrectionPrompt,
} from './reflection-prompt.util';
import {
  EToolFailureCategory,
  IToolFailureDiagnostic,
  IToolFailureReflectionContext,
} from '../../../contracts/engine/tool-reflection.interface';
import {
  TOOL_FAIL_FAST_TITLE,
  TOOL_REFLECTION_HEADER,
  CRITIC_FEEDBACK_HEADING,
} from '../../../constants/prompts/reflection.prompt';

describe('reflection-prompt.util', () => {
  describe('buildToolReflectiveMessage', () => {
    const baseContext: IToolFailureReflectionContext = {
      toolName: 'query_db',
      displayName: 'Query Database',
      rawErrorMessage: 'Table orders does not exist',
      args: { table: 'orders' },
      consecutiveFailures: 1,
      maxRetries: 2,
    };

    const baseDiagnostic: IToolFailureDiagnostic = {
      category: EToolFailureCategory.RESOURCE_NOT_FOUND,
      rootCauseDescription: 'Tài nguyên mục tiêu không tồn tại.',
      actionableGuidance: 'Hãy dùng công cụ tìm kiếm hoặc liệt kê trước.',
      canRetryWithAdjustment: true,
    };

    it('should format normal reflective guidance when retries remain', () => {
      const message = buildToolReflectiveMessage(baseContext, baseDiagnostic);

      expect(message).toContain('[LỖI CÔNG CỤ "Query Database"]');
      expect(message).toContain(TOOL_REFLECTION_HEADER);
      expect(message).toContain('Tài nguyên mục tiêu không tồn tại.');
      expect(message).toContain('Hãy dùng công cụ tìm kiếm hoặc liệt kê trước.');
      expect(message).toContain('ToolRepeatGuard');
    });

    it('should format fail-fast message when consecutive failures reach maxRetries', () => {
      const failFastContext: IToolFailureReflectionContext = {
        ...baseContext,
        consecutiveFailures: 2,
      };

      const message = buildToolReflectiveMessage(failFastContext, baseDiagnostic);

      expect(message).toContain(TOOL_FAIL_FAST_TITLE);
      expect(message).toContain('đã thất bại liên tiếp 2 lần');
      expect(message).toContain('Không tiếp tục gọi lại công cụ này nữa');
    });

    it('should format fail-fast message when diagnostic says cannot retry with adjustment', () => {
      const nonRetryableDiagnostic: IToolFailureDiagnostic = {
        ...baseDiagnostic,
        canRetryWithAdjustment: false,
      };

      const message = buildToolReflectiveMessage(baseContext, nonRetryableDiagnostic);

      expect(message).toContain(TOOL_FAIL_FAST_TITLE);
    });
  });

  describe('buildCriticCorrectionPrompt', () => {
    it('should format ungrounded numbers warning and guidance', () => {
      const prompt = buildCriticCorrectionPrompt(['45000000', '12%'], 0);

      expect(prompt).toContain(CRITIC_FEEDBACK_HEADING);
      expect(prompt).toContain('45000000, 12%');
      expect(prompt).toContain('YÊU CẦU: Hãy loại bỏ những con số tự tính toán');
    });

    it('should append missed question clause warning when count > 0', () => {
      const prompt = buildCriticCorrectionPrompt([], 2);

      expect(prompt).toContain(CRITIC_FEEDBACK_HEADING);
      expect(prompt).toContain('THIẾU NỘI DUNG');
    });
  });
});
