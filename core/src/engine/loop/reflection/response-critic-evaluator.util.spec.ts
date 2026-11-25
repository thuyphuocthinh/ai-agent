import { ResponseCriticEvaluatorUtil } from './response-critic-evaluator.util';
import { ECriticVerdict } from '../../../contracts/engine/critic-reflection.interface';
import { ToolCallTraceDto } from '../../../contracts/dtos/react-loop.dto';

describe('ResponseCriticEvaluatorUtil', () => {
  it('should return APPROVED when answer has no numbers or is empty', () => {
    const result = ResponseCriticEvaluatorUtil.evaluate('Prompt', '', []);
    expect(result.verdict).toBe(ECriticVerdict.APPROVED);
    expect(result.ungroundedNumbers).toEqual([]);
  });

  it('should return APPROVED when numbers match tool output (grounded)', () => {
    const toolCalls: ToolCallTraceDto[] = [
      {
        tool: 'db_query',
        status: 'success' as any,
        resultPreview: 'Found 42 active users and total balance of 1500000 VND',
      },
    ];

    const result = ResponseCriticEvaluatorUtil.evaluate(
      'How many users?',
      'There are 42 active users with total balance 1500000 VND.',
      toolCalls,
    );

    expect(result.verdict).toBe(ECriticVerdict.APPROVED);
    expect(result.ungroundedNumbers).toEqual([]);
  });

  it('should return NEEDS_REFINEMENT when answer contains hallucinated ungrounded numbers', () => {
    const toolCalls: ToolCallTraceDto[] = [
      {
        tool: 'db_query',
        status: 'success' as any,
        resultPreview: 'Found 42 active users.',
      },
    ];

    const result = ResponseCriticEvaluatorUtil.evaluate(
      'Check user status',
      'We have 42 users and revenue is 999999999 VND.',
      toolCalls,
    );

    expect(result.verdict).toBe(ECriticVerdict.NEEDS_REFINEMENT);
    expect(result.ungroundedNumbers.length).toBeGreaterThan(0);
    expect(result.feedbackPrompt).toBeDefined();
    expect(result.feedbackPrompt).toContain('999999999');
  });
});
