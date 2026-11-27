import { Test, TestingModule } from '@nestjs/testing';
import {
  CONTEXT_EDITED_HISTORY_SECTION_HEADER,
  CONVERSATION_SUMMARY_SECTION_HEADER,
  EMessageRole,
  ORCHESTRATION_CONSTANTS,
} from '@agent/core/constants';
import { SupervisorPromptBuilder } from './supervisor-prompt.builder';
import { MemoryManagerService } from '../../memory/memory-manager.service';
import {
  resolveDataCharBudget,
  resolveHistoryCharBudget,
  resolveMemoryCharBudget,
} from '../../common/text/token-budget.util';

describe('SupervisorPromptBuilder', () => {
  let builder: SupervisorPromptBuilder;
  const mockMemoryManager = {
    buildBudget: jest.fn((modelId: string) => ({
      toolResultCharBudget: resolveDataCharBudget(modelId),
      memoryCharBudget: resolveMemoryCharBudget(modelId),
      historyCharBudget: resolveHistoryCharBudget(modelId),
    })),
  };
  const MODEL_ID = 'gpt-4o-mini';

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SupervisorPromptBuilder,
        { provide: MemoryManagerService, useValue: mockMemoryManager },
      ],
    }).compile();

    builder = module.get<SupervisorPromptBuilder>(SupervisorPromptBuilder);
  });

  afterEach(() => jest.clearAllMocks());

  it('only includes the original prompt when there is no memory, history, or round yet', () => {
    const result = builder.build('câu hỏi', [], [], [], MODEL_ID);

    expect(result).toBe('Câu hỏi gốc của user: câu hỏi');
  });

  it('includes contextSummary in buildPlanPrompt while ignoring legacy memories in build() (AC-11 & AC-13)', () => {
    const withSummary = builder.buildPlanPrompt({
      originalPrompt: 'câu hỏi',
      previousRounds: [],
      history: [],
      modelId: MODEL_ID,
      contextSummary: 'notion.create_page: Page "Roadmap" (id=abc123)',
    });

    expect(withSummary).toContain(CONVERSATION_SUMMARY_SECTION_HEADER);
    expect(withSummary).toContain('notion.create_page: Page "Roadmap" (id=abc123)');

    const legacyResult = builder.build(
      'câu hỏi',
      [],
      [],
      [{ content: 'legacy fact' } as never],
      MODEL_ID,
    );
    expect(legacyResult).toBe('Câu hỏi gốc của user: câu hỏi');
  });

  it('preserves context-edited AI answers in history and truncates oversized AI replies (AC-12)', () => {
    const longAi = `HEAD_${'X'.repeat(ORCHESTRATION_CONSTANTS.CONTEXT_EDIT_AI_TEXT_MAX_CHARS + 500)}_TAIL`;
    const result = builder.buildPlanPrompt({
      originalPrompt: 'câu hỏi',
      previousRounds: [],
      history: [
        { role: EMessageRole.USER, text: 'Bảng Orders có bao nhiêu dòng?' },
        { role: EMessageRole.MODEL, text: 'Có 42 dòng' },
        { role: EMessageRole.MODEL, text: longAi },
      ],
      modelId: MODEL_ID,
    });

    expect(result).toContain(CONTEXT_EDITED_HISTORY_SECTION_HEADER);
    expect(result).toContain('User: Bảng Orders có bao nhiêu dòng?');
    expect(result).toContain('AI: Có 42 dòng');
    expect(result).toContain('đã lược bỏ');
  });

  it('includes rounds already run this turn, capped by the budget for the given model', () => {
    const rounds = [
      { agent: 'sql_server', task: 'đếm dòng', result: 'kết quả: 42' } as any,
    ];

    const result = builder.build('câu hỏi', rounds, [], [], MODEL_ID);

    expect(mockMemoryManager.buildBudget).toHaveBeenCalledWith(MODEL_ID);
    expect(result).toContain('Các bước đã thực hiện trong turn này');
    expect(result).toContain('sql_server');
    expect(result).toContain('kết quả: 42');
  });

  it('prepends a frustration warning before every other section when the prompt matches a frustration pattern', () => {
    const result = builder.buildPlanPrompt({
      originalPrompt: 'sao vẫn lỗi hoài vậy',
      previousRounds: [],
      history: [],
      modelId: MODEL_ID,
      contextSummary: 'tóm tắt cũ',
    });

    expect(result).toContain('dấu hiệu không hài lòng/bực bội');
    expect(result.indexOf('không hài lòng/bực bội')).toBeLessThan(
      result.indexOf(CONVERSATION_SUMMARY_SECTION_HEADER),
    );
  });

  it('orders sections as: summary, then history, then original prompt, then rounds', () => {
    const result = builder.buildPlanPrompt({
      originalPrompt: 'câu hỏi',
      previousRounds: [{ agent: 'sql_server', task: 't', result: 'r' }],
      history: [{ role: EMessageRole.USER, text: 'trước đó' }],
      modelId: MODEL_ID,
      contextSummary: 'tóm tắt cũ',
    });

    const summaryIdx = result.indexOf(CONVERSATION_SUMMARY_SECTION_HEADER);
    const historyIdx = result.indexOf(CONTEXT_EDITED_HISTORY_SECTION_HEADER);
    const promptIdx = result.indexOf('Câu hỏi gốc của user');
    const roundsIdx = result.indexOf('Các bước đã thực hiện trong turn này');

    expect(summaryIdx).toBeGreaterThanOrEqual(0);
    expect(summaryIdx).toBeLessThan(historyIdx);
    expect(historyIdx).toBeLessThan(promptIdx);
    expect(promptIdx).toBeLessThan(roundsIdx);
  });

  it('includes the skill catalog framed so the planner names the slug instead of calling read_skill itself', () => {
    const result = builder.build('câu hỏi', [], [], [], MODEL_ID, '- hotel-cancellation (Hotel): hủy phòng');

    expect(result).toContain('- hotel-cancellation (Hotel): hủy phòng');
    expect(result).toContain('KHÔNG gọi read_skill');
    expect(result).toContain('ghi rõ slug');
  });

  it('omits the skill section when the catalog is empty or not provided', () => {
    expect(builder.build('câu hỏi', [], [], [], MODEL_ID, '')).not.toContain('read_skill');
    expect(builder.build('câu hỏi', [], [], [], MODEL_ID)).not.toContain('read_skill');
  });

  it('places the skill catalog after summary and before history', () => {
    const result = builder.buildPlanPrompt({
      originalPrompt: 'câu hỏi',
      previousRounds: [],
      history: [{ role: EMessageRole.USER, text: 'trước đó' }],
      modelId: MODEL_ID,
      contextSummary: 'tóm tắt cũ',
      skillCatalog: '- a (A): mô tả',
    });

    const summaryIdx = result.indexOf(CONVERSATION_SUMMARY_SECTION_HEADER);
    const skillIdx = result.indexOf('Skill (playbook nghiệp vụ)');
    const historyIdx = result.indexOf(CONTEXT_EDITED_HISTORY_SECTION_HEADER);

    expect(summaryIdx).toBeLessThan(skillIdx);
    expect(skillIdx).toBeLessThan(historyIdx);
  });
});
