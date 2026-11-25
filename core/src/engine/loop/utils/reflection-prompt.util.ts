import {
  TOOL_REFLECTION_HEADER,
  TOOL_REFLECTION_DIAGNOSIS_PREFIX,
  TOOL_REFLECTION_GUIDANCE_PREFIX,
  TOOL_REFLECTION_REPEAT_WARNING,
  TOOL_REFLECTION_FOOTER,
  TOOL_FAIL_FAST_TITLE,
  TOOL_FAIL_FAST_MANDATORY_ACTION,
  CRITIC_FEEDBACK_HEADING,
  CRITIC_UNGROUNDED_METRIC_WARNING,
  CRITIC_UNGROUNDED_METRIC_ACTION,
  CRITIC_MISSED_CLAUSE_WARNING,
} from '../../../constants/prompts/reflection.prompt';
import type {
  IToolFailureDiagnostic,
  IToolFailureReflectionContext,
} from '../../../contracts/engine/tool-reflection.interface';

export function buildToolReflectiveMessage(
  context: IToolFailureReflectionContext,
  diagnostic: IToolFailureDiagnostic,
): string {
  const isFailFast =
    context.consecutiveFailures >= context.maxRetries || !diagnostic.canRetryWithAdjustment;

  if (isFailFast) {
    return [
      `[DỪNG THỬ LẠI - FAIL-FAST] ${TOOL_FAIL_FAST_TITLE} Công cụ "${context.displayName}" đã thất bại liên tiếp ${context.consecutiveFailures} lần.`,
      `Nguyên nhân: ${diagnostic.rootCauseDescription}`,
      TOOL_FAIL_FAST_MANDATORY_ACTION,
    ].join('\n');
  }

  return [
    `[LỖI THỰC THI CÔNG CỤ]: [LỖI CÔNG CỤ "${context.displayName}"]: ${context.rawErrorMessage}`,
    TOOL_REFLECTION_HEADER,
    `${TOOL_REFLECTION_DIAGNOSIS_PREFIX} ${diagnostic.rootCauseDescription}`,
    `${TOOL_REFLECTION_GUIDANCE_PREFIX} ${diagnostic.actionableGuidance}`,
    TOOL_REFLECTION_REPEAT_WARNING,
    TOOL_REFLECTION_FOOTER,
  ].join('\n');
}

export function buildCriticCorrectionPrompt(
  ungroundedNumbers: readonly string[],
  missedQuestionCount: number,
): string {
  const parts: string[] = [CRITIC_FEEDBACK_HEADING];

  if (ungroundedNumbers.length > 0) {
    parts.push(
      `${CRITIC_UNGROUNDED_METRIC_WARNING} ${ungroundedNumbers.join(', ')}`,
      CRITIC_UNGROUNDED_METRIC_ACTION,
    );
  }

  if (missedQuestionCount > 0) {
    parts.push(CRITIC_MISSED_CLAUSE_WARNING);
  }

  return parts.join('\n');
}
