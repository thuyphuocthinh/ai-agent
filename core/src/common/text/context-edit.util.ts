import { EMessageRole, ORCHESTRATION_CONSTANTS } from '@agent/core/constants';
import { ChatHistoryTurnDto } from '../../contracts/dtos/message-client.dto';

export function formatTurnRoleLabel(role: EMessageRole): string {
  return role === EMessageRole.USER ? 'User' : 'AI';
}

export function editTurnForContext<
  T extends Pick<ChatHistoryTurnDto, 'role' | 'text'>,
>(turn: T): T {
  const maxChars = ORCHESTRATION_CONSTANTS.CONTEXT_EDIT_AI_TEXT_MAX_CHARS;
  if (turn.role !== EMessageRole.MODEL || turn.text.length <= maxChars) {
    return turn;
  }

  const headLen = Math.floor(
    maxChars * ORCHESTRATION_CONSTANTS.CONTEXT_EDIT_HEAD_RATIO,
  );
  const tailLen = Math.floor(
    maxChars * ORCHESTRATION_CONSTANTS.CONTEXT_EDIT_TAIL_RATIO,
  );
  const omitted = turn.text.length - headLen - tailLen;
  const editedText = `${turn.text.slice(0, headLen)}\n...[đã lược bỏ ${omitted} ký tự giữa câu trả lời]...\n${turn.text.slice(-tailLen)}`;

  return { ...turn, text: editedText };
}

export function trimTurnsToCharBudget(
  turns: readonly ChatHistoryTurnDto[],
  charBudget: number,
): ChatHistoryTurnDto[] {
  if (turns.length === 0) return [];

  const kept: ChatHistoryTurnDto[] = [];
  let usedChars = 0;

  for (let i = turns.length - 1; i >= 0; i--) {
    const edited = editTurnForContext(turns[i]);
    const cost = edited.text.length;
    if (kept.length > 0 && usedChars + cost > charBudget) {
      break;
    }
    kept.push(edited);
    usedChars += cost;
  }

  return kept.reverse();
}
