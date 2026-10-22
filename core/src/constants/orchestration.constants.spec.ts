import {
  SUPERVISOR_PLANNING_PROMPT,
  SUPERVISOR_PLAN_SCHEMA,
  SUPERVISOR_PLAN_SCHEMA_NO_ANSWER,
} from './orchestration.constants';
import { toOpenAiStrictSchema } from '../engine/strategy/openai-strict-schema.util';

describe('Supervisor persona (AC-4)', () => {
  it.each([
    ['SUPERVISOR_PLAN_SCHEMA', SUPERVISOR_PLAN_SCHEMA],
    ['SUPERVISOR_PLAN_SCHEMA_NO_ANSWER', SUPERVISOR_PLAN_SCHEMA_NO_ANSWER],
  ])('%s allows an optional persona with required role and goal', (_name, schema) => {
    const step = schema.properties.steps.items;

    expect(step.properties.persona).toBeDefined();
    expect(step.properties.persona.required).toEqual(['role', 'goal']);
    expect(Object.keys(step.properties.persona.properties)).toEqual([
      'role',
      'goal',
      'constraints',
      'tone',
      'outputFormat',
    ]);
    // Persona là tuỳ chọn trên step: thiếu persona không được làm plan bị từ chối.
    expect(step.required).toEqual(['agent', 'task', 'mustExecute']);
  });

  it('stays valid for OpenAI strict mode: optional persona fields become nullable', () => {
    const strict = toOpenAiStrictSchema(SUPERVISOR_PLAN_SCHEMA) as any;
    const step = strict.properties.steps.items;

    expect(step.properties.persona.type).toEqual(['object', 'null']);
    expect(step.required).toContain('persona');
    expect(step.properties.persona.additionalProperties).toBe(false);
    expect(step.properties.persona.properties.tone.type).toEqual([
      'string',
      'null',
    ]);
    expect(step.properties.persona.properties.role.type).toBe('string');
  });

  it('the planning prompt always instructs the Supervisor to attach a persona', () => {
    expect(SUPERVISOR_PLANNING_PROMPT).toContain('"persona"');
    expect(SUPERVISOR_PLANNING_PROMPT).toContain('"role"');
    expect(SUPERVISOR_PLANNING_PROMPT).toContain('"goal"');
  });

  it('the planning prompt states that a persona never changes tools or permissions', () => {
    expect(SUPERVISOR_PLANNING_PROMPT).toContain(
      'KHÔNG thay đổi và KHÔNG mở rộng công cụ hay quyền',
    );
  });
});
