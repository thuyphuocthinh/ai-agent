import {
  parseBooleanEnv,
  parseNumberEnv,
  parsePositiveIntEnv,
} from './env.util';

describe('parseBooleanEnv', () => {
  it.each([
    ['true', true],
    ['TRUE', true],
    ['1', true],
    [' true ', true],
    ['false', false],
    ['False', false],
    ['0', false],
  ])('parses %j as %s', (raw, expected) => {
    expect(parseBooleanEnv(raw, !expected)).toBe(expected);
  });

  it.each([undefined, '', '  ', 'maybe', 'yes'])(
    'returns the fallback for %j',
    (raw) => {
      expect(parseBooleanEnv(raw, true)).toBe(true);
      expect(parseBooleanEnv(raw, false)).toBe(false);
    },
  );
});

describe('parseNumberEnv', () => {
  const inUnitRange = (n: number) => n > 0 && n <= 1;

  it('returns the parsed value when it passes the validator', () => {
    expect(parseNumberEnv('0.55', 0.4, inUnitRange)).toBe(0.55);
  });

  it.each([undefined, '', '  ', 'abc', 'NaN', 'Infinity', '0', '-1', '1.5'])(
    'returns the fallback for %j',
    (raw) => {
      expect(parseNumberEnv(raw, 0.4, inUnitRange)).toBe(0.4);
    },
  );
});

describe('parsePositiveIntEnv', () => {
  it('parses a positive integer', () => {
    expect(parsePositiveIntEnv('1500', 10)).toBe(1500);
  });

  it.each([undefined, '', '0', '-3', '2.5', 'abc'])(
    'returns the fallback for %j',
    (raw) => {
      expect(parsePositiveIntEnv(raw, 10)).toBe(10);
    },
  );
});
