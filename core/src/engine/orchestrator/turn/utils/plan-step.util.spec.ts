import {
  AvailableAgentDto,
  DelegationDto,
} from '../../../../contracts/dtos/supervisor.dto';
import { normalizePlanStepAgents } from './plan-step.util';

const agents: AvailableAgentDto[] = [
  { provider: 'sql_server', label: 'SQL Server', description: '' },
  { provider: 'google_sheets', label: 'Google Sheets', description: '' },
];

const step = (agent: string): DelegationDto => ({ agent, task: 't' });

describe('normalizePlanStepAgents', () => {
  it('keeps a step whose agent is already a provider', () => {
    const steps = [step('sql_server')];
    normalizePlanStepAgents(steps, agents);
    expect(steps[0].agent).toBe('sql_server');
  });

  it('maps a label (case-insensitive) to its provider, in place', () => {
    const steps = [step('sql server'), step('GOOGLE SHEETS')];
    const sameArray = steps;
    normalizePlanStepAgents(steps, agents);
    expect(sameArray.map((s) => s.agent)).toEqual(['sql_server', 'google_sheets']);
  });

  it('maps a label ignoring punctuation and spaces', () => {
    const steps = [step('Google-Sheets')];
    normalizePlanStepAgents(steps, agents);
    expect(steps[0].agent).toBe('google_sheets');
  });

  it('leaves an unknown agent untouched', () => {
    const steps = [step('unknown_agent')];
    normalizePlanStepAgents(steps, agents);
    expect(steps[0].agent).toBe('unknown_agent');
  });

  it('does not throw on an empty agent', () => {
    const steps = [step('')];
    normalizePlanStepAgents(steps, agents);
    expect(steps[0].agent).toBe('');
  });
});
