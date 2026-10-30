import {
  readSkillAutoloadConfig,
  SKILL_AUTOLOAD_DEFAULTS,
} from './skill-autoload.config';

describe('readSkillAutoloadConfig', () => {
  it('returns the defaults when no env var is set', () => {
    expect(readSkillAutoloadConfig({})).toEqual(SKILL_AUTOLOAD_DEFAULTS);
  });

  it('is enabled by default with a limit of 2 skills, 6000 chars and a 5000 ms timeout', () => {
    expect(readSkillAutoloadConfig({})).toMatchObject({
      enabled: true,
      maxSkills: 2,
      maxChars: 6000,
      timeoutMs: 5000,
    });
  });

  it('reads every override from the environment', () => {
    expect(
      readSkillAutoloadConfig({
        SKILL_AUTOLOAD_ENABLED: 'false',
        SKILL_AUTOLOAD_MIN_SCORE: '0.55',
        SKILL_AUTOLOAD_MAX_SKILLS: '3',
        SKILL_AUTOLOAD_MAX_CHARS: '2000',
        SKILL_AUTOLOAD_TIMEOUT_MS: '800',
      }),
    ).toEqual({
      enabled: false,
      minScore: 0.55,
      maxSkills: 3,
      maxChars: 2000,
      timeoutMs: 800,
    });
  });

  it.each([
    ['false', false],
    ['FALSE', false],
    ['0', false],
    ['true', true],
    ['1', true],
    [' true ', true],
  ])('parses SKILL_AUTOLOAD_ENABLED=%j as %s', (raw, expected) => {
    expect(readSkillAutoloadConfig({ SKILL_AUTOLOAD_ENABLED: raw }).enabled).toBe(
      expected,
    );
  });

  it.each(['', 'maybe', 'yes'])(
    'keeps the default for an unrecognised SKILL_AUTOLOAD_ENABLED=%j',
    (raw) => {
      expect(readSkillAutoloadConfig({ SKILL_AUTOLOAD_ENABLED: raw }).enabled).toBe(
        SKILL_AUTOLOAD_DEFAULTS.enabled,
      );
    },
  );

  it.each(['abc', '0', '-0.2', '1.5', 'NaN', ''])(
    'falls back to the default min score for invalid value %j',
    (raw) => {
      expect(readSkillAutoloadConfig({ SKILL_AUTOLOAD_MIN_SCORE: raw }).minScore).toBe(
        SKILL_AUTOLOAD_DEFAULTS.minScore,
      );
    },
  );

  it('accepts a min score of exactly 1', () => {
    expect(readSkillAutoloadConfig({ SKILL_AUTOLOAD_MIN_SCORE: '1' }).minScore).toBe(1);
  });

  it.each(['0', '-3', '2.5', 'abc', ''])(
    'falls back to the defaults for invalid integer value %j',
    (raw) => {
      const config = readSkillAutoloadConfig({
        SKILL_AUTOLOAD_MAX_SKILLS: raw,
        SKILL_AUTOLOAD_MAX_CHARS: raw,
        SKILL_AUTOLOAD_TIMEOUT_MS: raw,
      });

      expect(config.maxSkills).toBe(SKILL_AUTOLOAD_DEFAULTS.maxSkills);
      expect(config.maxChars).toBe(SKILL_AUTOLOAD_DEFAULTS.maxChars);
      expect(config.timeoutMs).toBe(SKILL_AUTOLOAD_DEFAULTS.timeoutMs);
    },
  );

  it('reads process.env at call time (no caching)', () => {
    const original = process.env.SKILL_AUTOLOAD_MAX_SKILLS;
    try {
      process.env.SKILL_AUTOLOAD_MAX_SKILLS = '5';
      expect(readSkillAutoloadConfig().maxSkills).toBe(5);
      process.env.SKILL_AUTOLOAD_MAX_SKILLS = '1';
      expect(readSkillAutoloadConfig().maxSkills).toBe(1);
    } finally {
      if (original === undefined) delete process.env.SKILL_AUTOLOAD_MAX_SKILLS;
      else process.env.SKILL_AUTOLOAD_MAX_SKILLS = original;
    }
  });
});
