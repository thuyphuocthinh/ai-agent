import { ORCHESTRATION_CONSTANTS } from '@agent/core/constants';
import {
  resolveEscalationModelId,
  resolveSupervisorModelId,
} from './supervisor-model.util';

const KEYS = [
  'SUPERVISOR_PLANNING_MODEL',
  'SUPERVISOR_EVALUATE_MODEL',
  'SUPERVISOR_MODEL',
  'SUPERVISOR_ESCALATION_MODEL',
] as const;

describe('supervisor model resolution', () => {
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of KEYS) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  });

  describe('resolveSupervisorModelId', () => {
    it.each(['plan', 'evaluate', 'synthesize'] as const)(
      'falls back to the default constant for "%s" when nothing is configured',
      (kind) => {
        expect(resolveSupervisorModelId(kind)).toBe(
          ORCHESTRATION_CONSTANTS.SUPERVISOR_MODEL,
        );
      },
    );

    it.each(['plan', 'evaluate', 'synthesize'] as const)(
      'uses SUPERVISOR_MODEL for "%s" when there is no specific model',
      (kind) => {
        process.env.SUPERVISOR_MODEL = 'general-model';

        expect(resolveSupervisorModelId(kind)).toBe('general-model');
      },
    );

    it('prefers SUPERVISOR_PLANNING_MODEL for planning only', () => {
      process.env.SUPERVISOR_MODEL = 'general-model';
      process.env.SUPERVISOR_PLANNING_MODEL = 'planner-model';

      expect(resolveSupervisorModelId('plan')).toBe('planner-model');
      expect(resolveSupervisorModelId('evaluate')).toBe('general-model');
      expect(resolveSupervisorModelId('synthesize')).toBe('general-model');
    });

    it('prefers SUPERVISOR_EVALUATE_MODEL for evaluation only', () => {
      process.env.SUPERVISOR_MODEL = 'general-model';
      process.env.SUPERVISOR_EVALUATE_MODEL = 'cheap-model';

      expect(resolveSupervisorModelId('evaluate')).toBe('cheap-model');
      expect(resolveSupervisorModelId('plan')).toBe('general-model');
      expect(resolveSupervisorModelId('synthesize')).toBe('general-model');
    });

    it('reads the environment on every call (no caching)', () => {
      process.env.SUPERVISOR_MODEL = 'first';
      expect(resolveSupervisorModelId('plan')).toBe('first');

      process.env.SUPERVISOR_MODEL = 'second';
      expect(resolveSupervisorModelId('plan')).toBe('second');
    });
  });

  describe('resolveEscalationModelId', () => {
    it('is undefined (no escalation) when not configured', () => {
      expect(resolveEscalationModelId()).toBeUndefined();
    });

    it('returns the configured escalation model', () => {
      process.env.SUPERVISOR_ESCALATION_MODEL = 'strong-model';

      expect(resolveEscalationModelId()).toBe('strong-model');
    });
  });
});
