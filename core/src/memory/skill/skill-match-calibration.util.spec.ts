import {
  findFailures,
  findPassingThresholdRange,
  ScoredPrompt,
} from './skill-match-calibration.util';

const row = (
  prompt: string,
  expected: string | null,
  ...ranking: [string, number][]
): ScoredPrompt => ({
  prompt,
  expected,
  ranking: ranking.map(([slug, score]) => ({ slug, score })),
});

describe('findFailures', () => {
  const rows = [
    row('đổi tên sản phẩm', 'sql', ['sql', 0.6], ['report', 0.2]),
    row('2 cộng 2', null, ['sql', 0.15]),
  ];

  it('returns nothing when every prompt is classified as expected', () => {
    expect(findFailures(rows, 0.4)).toEqual([]);
  });

  it('flags a positive prompt whose best score is under the threshold', () => {
    expect(findFailures(rows, 0.7)).toEqual([
      { prompt: 'đổi tên sản phẩm', expected: 'sql', predicted: null, topScore: 0.6 },
    ]);
  });

  it('flags a negative prompt that reaches the threshold', () => {
    expect(findFailures(rows, 0.1)).toEqual([
      { prompt: '2 cộng 2', expected: null, predicted: 'sql', topScore: 0.15 },
    ]);
  });

  it('flags a positive prompt answered by a different skill', () => {
    const wrong = [row('đổi tên', 'sql', ['report', 0.7], ['sql', 0.5])];

    expect(findFailures(wrong, 0.4)).toEqual([
      { prompt: 'đổi tên', expected: 'sql', predicted: 'report', topScore: 0.7 },
    ]);
  });

  it('treats a score equal to the threshold as loaded', () => {
    expect(findFailures([row('a', 'sql', ['sql', 0.5])], 0.5)).toEqual([]);
  });

  it('treats a prompt without any candidate as not loaded', () => {
    expect(findFailures([row('a', null)], 0.1)).toEqual([]);
    expect(findFailures([row('a', 'sql')], 0.1)).toHaveLength(1);
  });
});

describe('findPassingThresholdRange', () => {
  it('returns the open-closed range between the best negative and the worst positive', () => {
    const range = findPassingThresholdRange([
      row('p1', 'sql', ['sql', 0.62]),
      row('p2', 'report', ['report', 0.48], ['sql', 0.3]),
      row('n1', null, ['sql', 0.21]),
      row('n2', null, ['report', 0.3]),
    ]);

    expect(range).toEqual({
      lowerExclusive: 0.3,
      upperInclusive: 0.48,
      recommended: expect.closeTo(0.39, 5),
    });
  });

  it('returns null when a negative scores at least as high as a positive', () => {
    expect(
      findPassingThresholdRange([
        row('p', 'sql', ['sql', 0.4]),
        row('n', null, ['sql', 0.45]),
      ]),
    ).toBeNull();
  });

  it('returns null when the expected skill is not the top one of a positive prompt', () => {
    expect(
      findPassingThresholdRange([row('p', 'sql', ['report', 0.7], ['sql', 0.6])]),
    ).toBeNull();
  });

  it('accepts any threshold up to the worst positive when there is no negative', () => {
    expect(findPassingThresholdRange([row('p', 'sql', ['sql', 0.5])])).toEqual({
      lowerExclusive: 0,
      upperInclusive: 0.5,
      recommended: 0.25,
    });
  });

  it('the recommended threshold classifies the whole set correctly', () => {
    const rows = [
      row('p1', 'sql', ['sql', 0.62]),
      row('n1', null, ['sql', 0.21]),
    ];
    const range = findPassingThresholdRange(rows)!;

    expect(findFailures(rows, range.recommended)).toEqual([]);
  });
});
