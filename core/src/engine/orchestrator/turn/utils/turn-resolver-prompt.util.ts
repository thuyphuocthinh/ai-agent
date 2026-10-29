import {
  GUARDRAIL_BLOCKED_MARKER,
  ORIGINAL_PROMPT_CONTEXT_HEADER,
  PARTIAL_STEP_TASK_SUFFIX,
  PRIOR_ROUNDS_CONTEXT_HEADER,
  REPLAN_MARKER,
  REPLAN_RESULT_DETAIL,
  SCOPE_LIMIT_NOTE,
} from '../../../../constants/prompts';

export interface RoundText {
  agent: string;
  task: string;
  result: string;
}

// `result` của round đánh dấu bước vừa xong không đạt kỳ vọng và đã lập lại kế hoạch.
export function buildReplanRoundResult(): string {
  return `${REPLAN_MARKER}${REPLAN_RESULT_DETAIL}`;
}

// `result` của round khi guardrail chặn một bước nghi chọn sai agent.
export function buildGuardrailBlockedResult(
  plannedAgent: string,
  mentionedLabel: string,
  mentionedProvider: string,
): string {
  return `${GUARDRAIL_BLOCKED_MARKER} — kế hoạch chọn hệ thống "${plannedAgent}" nhưng yêu cầu nhắc rõ tới hệ thống "${mentionedLabel}" (đã kết nối, provider "${mentionedProvider}") — có khả năng chọn sai agent, cần lập lại kế hoạch.`;
}

// Câu trả lời khi kế hoạch chọn toàn agent không tồn tại trong các kết nối hiện có.
export function buildUnknownAgentAnswer(attemptedAgents: string): string {
  return `Mình chưa thể xử lý yêu cầu này với các kết nối hiện có (Tên hệ thống mà AI đang cố gọi: "${attemptedAgents}" - Vui lòng đổi tên hoặc viết đúng tên). Vào Settings để kết nối agent phù hợp nhé.`;
}

// Task của round chỉ chứa phần dữ liệu đã thu thập trước khi cần duyệt một hành động khác.
export function buildPartialStepTask(task: string): string {
  return `${task}${PARTIAL_STEP_TASK_SUFFIX}`;
}

// Prompt gửi cho agent khi ủy quyền một bước: task, kèm (khi task khác yêu cầu gốc) yêu cầu
// gốc đầy đủ, và (khi có) dữ liệu THẬT của các bước trước. `limitScope` = còn bước khác trong
// kế hoạch → dặn worker chỉ làm phần việc của task. `priorRounds` đã cắt theo ngân sách.
export function buildDelegationPrompt(input: {
  task: string;
  originalPrompt: string;
  limitScope: boolean;
  priorRounds: readonly RoundText[];
}): string {
  const { task, originalPrompt, limitScope, priorRounds } = input;
  const contextBlocks: string[] = [task];
  if (task !== originalPrompt) {
    const scopeNote = limitScope ? SCOPE_LIMIT_NOTE : '';
    contextBlocks.push(
      `${ORIGINAL_PROMPT_CONTEXT_HEADER}${scopeNote}\n${originalPrompt}`,
    );
  }
  if (priorRounds.length > 0) {
    const roundsText = priorRounds
      .map(
        (r, i) =>
          `${i + 1}. Agent "${r.agent}" (yêu cầu: "${r.task}") → kết quả: ${r.result}`,
      )
      .join('\n');
    contextBlocks.push(`${PRIOR_ROUNDS_CONTEXT_HEADER}\n${roundsText}`);
  }
  return contextBlocks.join('\n\n');
}
