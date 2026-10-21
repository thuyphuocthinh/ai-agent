import {
  buildUngroundedNumbersDisclaimer,
  extractNumericFacts,
  parseNumberCandidates,
  verifyNumericFactConsistency,
} from './numeric-fact-consistency.util';

const noIgnore = { ignoreIntegersAtMost: 0, ignoreYearLike: false };

describe('parseNumberCandidates', () => {
  it.each([
    ['42', [{ value: 42, decimals: 0 }]],
    ['3.14', [{ value: 3.14, decimals: 2 }]],
    ['3,14', [{ value: 3.14, decimals: 2 }]],
    ['1.250.000', [{ value: 1250000, decimals: 0 }]],
    ['1,250,000', [{ value: 1250000, decimals: 0 }]],
    ['1.250.000,50', [{ value: 1250000.5, decimals: 2 }]],
    ['1,250,000.50', [{ value: 1250000.5, decimals: 2 }]],
    ['0,500', [{ value: 0.5, decimals: 3 }]],
  ])('reads %s', (raw, expected) => {
    expect(parseNumberCandidates(raw)).toEqual(expected);
  });

  it.each(['1.250', '1,250'])(
    'keeps both readings of the ambiguous %s',
    (raw) => {
      expect(parseNumberCandidates(raw)).toEqual([
        { value: 1250, decimals: 0 },
        { value: 1.25, decimals: 3 },
      ]);
    },
  );

  it.each(['1,2,3', '10.20.30'])(
    'splits %s into separate integers instead of one malformed number',
    (raw) => {
      expect(parseNumberCandidates(raw).length).toBeGreaterThan(1);
    },
  );
});

describe('extractNumericFacts', () => {
  const raws = (text: string) => extractNumericFacts(text).map((f) => f.raw);

  it.each([
    ['Tổng doanh thu là 1.250.000đ', ['1.250.000đ']],
    ['Tổng là 1.250.000.', ['1.250.000']],
    ['Tăng 25%.', ['25%']],
    ['Giá 99.000 VND, phí 2k', ['99.000 VND', '2k']],
    ['Doanh thu 1,5 tỷ', ['1,5 tỷ']],
    ['Nạp 5 triệu', ['5 triệu']],
    ['1 tỷ 500 triệu 200 nghìn', ['1 tỷ 500 triệu 200 nghìn']],
  ])('finds the figures in %j', (text, expected) => {
    expect(raws(text)).toEqual(expected);
  });

  it.each([
    ['ISO date and clock time', 'Lúc 2026-10-21 14:00:05 UTC'],
    ['slash date', 'Ngày 21/10/2026'],
    ['dot date', 'Ngày 21.10.2026'],
    ['identifiers', 'usr_99, KH-9981, tx1234, v2'],
    ['unknown glued suffix', 'nặng 5kg, lúc 14h30, 3abc'],
  ])('ignores %s', (_label, text) => {
    expect(raws(text)).toEqual([]);
  });

  it('is safe on empty and non-string input', () => {
    expect(extractNumericFacts('')).toEqual([]);
    expect(extractNumericFacts(undefined as unknown as string)).toEqual([]);
  });
});

describe('verifyNumericFactConsistency (AC-6)', () => {
  const verify = (
    answer: string,
    sources: string[],
    options: Parameters<typeof verifyNumericFactConsistency>[2] = noIgnore,
  ) => verifyNumericFactConsistency(answer, sources, options);

  describe('grounded figures are never reported', () => {
    it.each([
      ['VN thousands with currency suffix', 'Tổng 1.250.000đ', 'amount: 1250000'],
      ['US thousands', 'Total 1,250,000.50', '{"total":1250000.5}'],
      ['VN decimal comma', 'Tổng 1.250.000,50', 'total=1250000.50'],
      ['billion unit', 'Doanh thu 1,5 tỷ', 'total=1500000000'],
      ['compound amount', 'Có 1 tỷ 500 triệu', 'total=1500000000'],
      ['million unit', 'Nạp 15 triệu', 'amount 15000000'],
      ['rounded in millions', 'Khoảng 1,25 triệu', 'amount 1253000'],
      ['percent', 'Tăng 12,5%', 'growth 12.5'],
      ['rounded decimal', 'Trung bình 12,46', 'avg 12.4567'],
      ['ambiguous reading as thousands', 'Có 1.250 dòng', 'rows: 1250'],
      ['ambiguous reading as decimal', 'Điểm 1.250', 'score 1.25'],
      ['trailing punctuation', 'Tổng là 1.250.000.', 'amount: 1250000'],
      ['number inside a JSON source', 'Phí 0,5', '{"amount":1250000,"fee":0.5}'],
    ])('%s', (_label, answer, source) => {
      expect(verify(answer, [source])).toMatchObject({
        isConsistent: true,
        ungrounded: [],
      });
    });
  });

  describe('figures missing from the sources are reported', () => {
    it.each([
      ['no sources at all', 'Tổng 1.250.000đ', [], ['1.250.000đ']],
      ['a different amount', 'Tổng 1.250.000đ', ['amount: 1350000'], ['1.250.000đ']],
      ['wrong magnitude', 'Nạp 15 triệu', ['amount 1500000'], ['15 triệu']],
      ['rounding too coarse', 'Khoảng 1,25 triệu', ['amount 1300000'], ['1,25 triệu']],
      ['ambiguous reading matching nothing', 'Có 1.250 dòng', ['rows: 999'], ['1.250']],
    ])('%s', (_label, answer, sources, expected) => {
      const result = verify(answer, sources);

      expect(result.isConsistent).toBe(false);
      expect(result.ungrounded).toEqual(expected);
    });
  });

  it('separates grounded from ungrounded figures in one answer', () => {
    const result = verify('Có 120 giao dịch, tổng 5.000.000đ, phí 7.500đ', [
      'count: 120',
      'sum: 5000000',
    ]);

    expect(result.grounded).toEqual(['120', '5.000.000đ']);
    expect(result.ungrounded).toEqual(['7.500đ']);
  });

  it('reports a repeated ungrounded figure once', () => {
    expect(verify('Giá 999 và 999 và 999', []).ungrounded).toEqual(['999']);
  });

  it('treats a figure restated from the user request as grounded when it is passed as a source', () => {
    const result = verify('Khách nạp 5 triệu nhưng ví không tăng', [
      'Kiểm tra vì sao khách nạp 5 triệu lúc 14:00 mà ví không nhảy số',
    ]);

    expect(result.isConsistent).toBe(true);
  });

  it('ignores dates, times and identifiers', () => {
    expect(
      verify('Giao dịch usr_99 lúc 2026-10-21 14:00 mã KH-9981', []).isConsistent,
    ).toBe(true);
  });

  describe('default options skip noise', () => {
    it('ignores small integers and year-like numbers', () => {
      expect(
        verifyNumericFactConsistency('Có 3 bảng trong năm 2026', []).isConsistent,
      ).toBe(true);
    });

    it('still reports them when the options are turned off', () => {
      expect(verify('Có 3 bảng trong năm 2026', []).ungrounded).toEqual([
        '3',
        '2026',
      ]);
    });

    it('does not ignore a small figure that carries a unit', () => {
      expect(
        verifyNumericFactConsistency('Tăng 5%', []).ungrounded,
      ).toEqual(['5%']);
    });
  });

  it('handles an empty answer', () => {
    expect(verify('', ['amount 5'])).toEqual({
      isConsistent: true,
      grounded: [],
      ungrounded: [],
    });
  });

  it('stays fast on large sources', () => {
    const source = Array.from({ length: 20000 }, (_, i) => `row${i}: ${i * 7}`).join(
      '\n',
    );
    const start = performance.now();

    const result = verify('Tổng 70007 và 123457', [source]);

    expect(performance.now() - start).toBeLessThan(1000);
    expect(result.grounded).toEqual(['70007']);
    expect(result.ungrounded).toEqual(['123457']);
  });
});

describe('buildUngroundedNumbersDisclaimer', () => {
  it('lists the figures and asks the reader to double-check', () => {
    const text = buildUngroundedNumbersDisclaimer(['1.250', '99']);

    expect(text).toContain('(1.250, 99)');
    expect(text).toContain('đối chiếu lại');
  });

  it('truncates a long list and states how many were left out', () => {
    const text = buildUngroundedNumbersDisclaimer(
      ['1', '2', '3', '4', '5', '6', '7'],
    );

    expect(text).toContain('(1, 2, 3, 4, 5 và 2 số khác)');
  });
});
