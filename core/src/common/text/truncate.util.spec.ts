import { truncateToSingleLine } from './truncate.util';

describe('truncateToSingleLine', () => {
  it('returns short text unchanged', () => {
    expect(truncateToSingleLine('mô tả ngắn', 80)).toBe('mô tả ngắn');
  });

  it('collapses whitespace and newlines into a single line', () => {
    expect(truncateToSingleLine('  dòng 1\n\n dòng   2\t', 80)).toBe('dòng 1 dòng 2');
  });

  it('cuts long text to maxChars including the ellipsis', () => {
    const result = truncateToSingleLine('x'.repeat(200), 20);

    expect(result).toHaveLength(20);
    expect(result.endsWith('…')).toBe(true);
  });

  it('keeps text of exactly maxChars characters', () => {
    expect(truncateToSingleLine('x'.repeat(20), 20)).toBe('x'.repeat(20));
  });
});
