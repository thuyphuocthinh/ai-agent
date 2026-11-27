import { EMessageRole, ORCHESTRATION_CONSTANTS } from '@agent/core/constants';
import { ChatHistoryTurnDto } from '../../contracts/dtos/message-client.dto';
import {
  editTurnForContext,
  formatTurnRoleLabel,
  trimTurnsToCharBudget,
} from './context-edit.util';

describe('context-edit.util', () => {
  describe('formatTurnRoleLabel', () => {
    it('formats USER and MODEL roles consistently', () => {
      expect(formatTurnRoleLabel(EMessageRole.USER)).toBe('User');
      expect(formatTurnRoleLabel(EMessageRole.MODEL)).toBe('AI');
    });
  });

  describe('editTurnForContext', () => {
    it('keeps short AI turns and long User turns unchanged', () => {
      const shortAi: ChatHistoryTurnDto = {
        role: EMessageRole.MODEL,
        text: 'a'.repeat(ORCHESTRATION_CONSTANTS.CONTEXT_EDIT_AI_TEXT_MAX_CHARS),
      };
      const longUser: ChatHistoryTurnDto = {
        role: EMessageRole.USER,
        text: 'u'.repeat(ORCHESTRATION_CONSTANTS.CONTEXT_EDIT_AI_TEXT_MAX_CHARS + 500),
      };

      expect(editTurnForContext(shortAi)).toBe(shortAi);
      expect(editTurnForContext(longUser)).toBe(longUser);
    });

    it('truncates middle of oversized AI turns preserving head and tail ratios', () => {
      const maxChars = ORCHESTRATION_CONSTANTS.CONTEXT_EDIT_AI_TEXT_MAX_CHARS;
      const headExpectedLen = Math.floor(
        maxChars * ORCHESTRATION_CONSTANTS.CONTEXT_EDIT_HEAD_RATIO,
      );
      const tailExpectedLen = Math.floor(
        maxChars * ORCHESTRATION_CONSTANTS.CONTEXT_EDIT_TAIL_RATIO,
      );
      const longText = `HEAD_${'A'.repeat(2000)}_TAIL`;
      const edited = editTurnForContext({
        role: EMessageRole.MODEL,
        text: longText,
      });

      expect(edited.role).toBe(EMessageRole.MODEL);
      expect(edited.text.startsWith(longText.slice(0, headExpectedLen))).toBe(true);
      expect(edited.text.endsWith(longText.slice(-tailExpectedLen))).toBe(true);
      expect(edited.text).toContain('đã lược bỏ');
      expect(edited.text.length).toBeLessThan(longText.length);
    });
  });

  describe('trimTurnsToCharBudget', () => {
    it('returns empty array for empty input', () => {
      expect(trimTurnsToCharBudget([], 100)).toEqual([]);
    });

    it('keeps most recent turns fitting budget while editing long AI turns and preserving latest turn', () => {
      const turns: ChatHistoryTurnDto[] = [
        { role: EMessageRole.USER, text: 'turn-1-' + 'x'.repeat(30) },
        { role: EMessageRole.MODEL, text: 'turn-2-' + 'y'.repeat(30) },
        { role: EMessageRole.USER, text: 'turn-3-latest' },
      ];

      const kept = trimTurnsToCharBudget(turns, 55);
      expect(kept).toEqual([turns[1], turns[2]]);

      const overshot = trimTurnsToCharBudget(
        [{ role: EMessageRole.USER, text: 'single-oversized-turn' }],
        5,
      );
      expect(overshot).toHaveLength(1);
      expect(overshot[0].text).toBe('single-oversized-turn');
    });
  });
});
