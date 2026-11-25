import {
  verifyNumericFactConsistency,
  type NumericFactConsistencyResult,
} from '../../../security/numeric-fact-consistency.util';
import type { ToolCallTraceDto } from '../../../contracts/dtos/react-loop.dto';
import {
  ECriticVerdict,
  type ICriticEvaluationResult,
} from '../../../contracts/engine/critic-reflection.interface';
import { buildCriticCorrectionPrompt } from '../utils/reflection-prompt.util';

export class ResponseCriticEvaluatorUtil {
  public static evaluate(
    _userPrompt: string,
    answerText: string,
    toolCalls: readonly ToolCallTraceDto[],
  ): ICriticEvaluationResult {
    if (!answerText.trim() || toolCalls.length === 0) {
      return {
        verdict: ECriticVerdict.APPROVED,
        ungroundedNumbers: [],
        missedQuestionCount: 0,
      };
    }

    const sources = toolCalls
      .flatMap((tc) => [tc.resultPreview, tc.argsPreview])
      .filter((text): text is string => typeof text === 'string' && text.length > 0);

    if (sources.length === 0) {
      return {
        verdict: ECriticVerdict.APPROVED,
        ungroundedNumbers: [],
        missedQuestionCount: 0,
      };
    }

    const factCheckResult: NumericFactConsistencyResult = verifyNumericFactConsistency(
      answerText,
      sources,
    );

    const hasHallucinatedNumbers =
      !factCheckResult.isConsistent && factCheckResult.ungrounded.length > 0;
    const ungroundedNumbers = factCheckResult.ungrounded;

    if (hasHallucinatedNumbers) {
      const feedbackPrompt = buildCriticCorrectionPrompt(ungroundedNumbers, 0);
      return {
        verdict: ECriticVerdict.NEEDS_REFINEMENT,
        ungroundedNumbers,
        missedQuestionCount: 0,
        feedbackPrompt,
      };
    }

    return {
      verdict: ECriticVerdict.APPROVED,
      ungroundedNumbers: [],
      missedQuestionCount: 0,
    };
  }
}
