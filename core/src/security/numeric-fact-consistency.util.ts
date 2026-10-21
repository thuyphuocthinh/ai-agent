// Chốt chặn chống "ảo giác số liệu": đối soát các con số trong câu trả lời cuối
// với nguồn thật (output tool + yêu cầu của user). Hàm thuần, không I/O.
//
// Phạm vi có chủ đích: chỉ kiểm tra SỐ (tiền, phần trăm, số lượng, số thập phân).
// Ngày/giờ và định danh (usr_99, KH-9981, tx1234) bị bỏ qua vì mỗi nơi viết một
// kiểu, kiểm tra chỉ sinh cảnh báo nhầm. Số do model TỰ TÍNH (tổng, trung bình)
// không có nguyên văn trong nguồn nên sẽ bị báo — lời cảnh báo vì thế chỉ nói
// "chưa tìm thấy trong nguồn", không khẳng định là bịa.

export interface NumericFactOptions {
  /** Bỏ qua số nguyên không đơn vị ≤ ngưỡng này (đếm/thứ tự thông thường). */
  ignoreIntegersAtMost?: number;
  /** Bỏ qua số nguyên 4 chữ số trông như năm (1900–2100). */
  ignoreYearLike?: boolean;
}

export const DEFAULT_NUMERIC_FACT_OPTIONS: Required<NumericFactOptions> = {
  ignoreIntegersAtMost: 10,
  ignoreYearLike: true,
};

interface NumericCandidate {
  value: number;
  /** Sai số cho phép khi đối chiếu: làm tròn ở số chữ số thập phân đã viết. */
  tolerance: number;
}

export interface NumericFact {
  /** Nguyên văn trong văn bản, gồm cả đơn vị (VD "1.250.000đ", "1,5 tỷ"). */
  raw: string;
  hasUnit: boolean;
  /** Một token có thể đọc theo 2 cách (VD "1.250" = 1250 hoặc 1,25). */
  candidates: NumericCandidate[];
  /** Số nguyên thuần, không đơn vị, không dấu phân cách (đối tượng của các luật bỏ qua). */
  isPlainInteger: boolean;
}

export interface NumericFactConsistencyResult {
  isConsistent: boolean;
  grounded: string[];
  ungrounded: string[];
}

const DATE_TIME_PATTERNS: RegExp[] = [
  /\b\d{4}-\d{2}-\d{2}(?:[T ]\d{1,2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?/g,
  /\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b/g,
  /\b\d{1,2}\.\d{1,2}\.\d{4}\b/g,
  /\b\d{1,2}:\d{2}(?::\d{2})?\b/g,
];

const NUMBER_PATTERN = /\d[\d.,]*\d|\d/g;
const IDENTIFIER_CHAR = /[\p{L}\p{N}_]/u;
const END_OF_WORD = '(?![\\p{L}\\p{N}_])';
const UNIT_PATTERN = new RegExp(
  `^\\s?(%|đ|₫|vn[dđ]|usd|nghìn|ngàn|triệu|tỷ|tỉ|million|billion|k)${END_OF_WORD}`,
  'iu',
);
const SMALLER_UNIT_PATTERN = new RegExp(
  `^\\s+(\\d[\\d.,]*\\d|\\d)\\s?(nghìn|ngàn|triệu|k)${END_OF_WORD}`,
  'iu',
);

const UNIT_MULTIPLIER: Record<string, number> = {
  k: 1e3,
  nghìn: 1e3,
  ngàn: 1e3,
  triệu: 1e6,
  million: 1e6,
  tỷ: 1e9,
  tỉ: 1e9,
  billion: 1e9,
};

const EPSILON = 1e-9;

interface ParsedNumber {
  value: number;
  decimals: number;
}

function maskDatesAndTimes(text: string): string {
  return DATE_TIME_PATTERNS.reduce((t, p) => t.replace(p, ' '), text);
}

function isValidGrouping(parts: string[]): boolean {
  return (
    parts[0].length >= 1 &&
    parts[0].length <= 3 &&
    parts.slice(1).every((p) => p.length === 3)
  );
}

// "1,2,3" hay "10.20.30": không phải 1 số có phân cách hàng nghìn — coi là các số rời.
function splitIntoIntegers(raw: string): ParsedNumber[] {
  return raw
    .split(/[.,]/)
    .filter(Boolean)
    .map((part) => ({ value: Number(part), decimals: 0 }));
}

/**
 * Đọc 1 token số theo cả kiểu VN (1.250.000,50) lẫn US (1,250,000.50). Chỉ khi
 * token có DUY NHẤT 1 dấu phân cách và đúng 3 chữ số phía sau ("1.250") mới mơ
 * hồ giữa hàng nghìn và thập phân — khi đó trả cả 2 cách đọc.
 */
export function parseNumberCandidates(raw: string): ParsedNumber[] {
  const dots = (raw.match(/\./g) ?? []).length;
  const commas = (raw.match(/,/g) ?? []).length;

  if (dots === 0 && commas === 0) return [{ value: Number(raw), decimals: 0 }];

  if (dots > 0 && commas > 0) {
    const decimalSep = raw.lastIndexOf('.') > raw.lastIndexOf(',') ? '.' : ',';
    const thousandSep = decimalSep === '.' ? ',' : '.';
    const decimalIdx = raw.lastIndexOf(decimalSep);
    const intPart = raw.slice(0, decimalIdx);
    const frac = raw.slice(decimalIdx + 1);
    if (
      intPart.includes(decimalSep) ||
      !isValidGrouping(intPart.split(thousandSep))
    ) {
      return splitIntoIntegers(raw);
    }
    return [
      {
        value: Number(`${intPart.split(thousandSep).join('')}.${frac}`),
        decimals: frac.length,
      },
    ];
  }

  const sep = dots > 0 ? '.' : ',';
  const parts = raw.split(sep);
  if (parts.length > 2) {
    return isValidGrouping(parts)
      ? [{ value: Number(parts.join('')), decimals: 0 }]
      : splitIntoIntegers(raw);
  }

  const [intPart, frac] = parts;
  const decimalReading = {
    value: Number(`${intPart}.${frac}`),
    decimals: frac.length,
  };
  const couldBeThousands =
    frac.length === 3 && intPart.length <= 3 && !intPart.startsWith('0');
  return couldBeThousands
    ? [{ value: Number(`${intPart}${frac}`), decimals: 0 }, decimalReading]
    : [decimalReading];
}

function multiplierOf(unit: string | undefined): number {
  return unit ? (UNIT_MULTIPLIER[unit.toLowerCase()] ?? 1) : 1;
}

function toCandidate(
  parsed: ParsedNumber,
  multiplier: number,
  hasMagnitudeUnit: boolean,
): NumericCandidate {
  const roundingStep = 0.5 * Math.pow(10, -parsed.decimals);
  let tolerance = 0;
  if (hasMagnitudeUnit) {
    tolerance = roundingStep * multiplier;
  } else if (parsed.decimals > 0) {
    tolerance = roundingStep;
  }
  return { value: parsed.value * multiplier, tolerance };
}

/**
 * Trích mọi con số (kèm đơn vị %, đ, k, nghìn, triệu, tỷ...) trong văn bản.
 * Quét tuần tự bằng 1 regex số rồi xét ngữ cảnh từng token — không dựa vào ký tự
 * sau token, nên dấu câu cuối câu ("1.250.000đ.") không làm cụt số như bản cũ.
 */
export function extractNumericFacts(text: string): NumericFact[] {
  if (!text || typeof text !== 'string') return [];

  const masked = maskDatesAndTimes(text);
  const facts: NumericFact[] = [];
  const pattern = new RegExp(NUMBER_PATTERN.source, 'g');
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(masked)) !== null) {
    const raw = match[0];
    const start = match.index;
    const prev = masked[start - 1];
    const beforePrev = masked[start - 2];

    if (prev && (IDENTIFIER_CHAR.test(prev) || prev === '.' || prev === ',')) {
      continue;
    }
    if (prev === '-' && beforePrev && IDENTIFIER_CHAR.test(beforePrev)) {
      continue;
    }

    let end = start + raw.length;
    const unitMatch = UNIT_PATTERN.exec(masked.slice(end));
    const next = masked[end];
    if (!unitMatch && next && IDENTIFIER_CHAR.test(next)) {
      continue; // hậu tố lạ dính liền ("5kg", "14h30", "3abc") — không phải số liệu.
    }

    const unit = unitMatch?.[1]?.toLowerCase();
    let multiplier = multiplierOf(unit);
    const hasMagnitudeUnit = multiplier > 1;
    let candidates = parseNumberCandidates(raw).map((p) =>
      toCandidate(p, multiplier, hasMagnitudeUnit),
    );
    if (unitMatch) end += unitMatch[0].length;

    // "1 tỷ 500 triệu" = 1.500.000.000: cộng các phần có đơn vị nhỏ dần.
    while (hasMagnitudeUnit && candidates.length === 1) {
      const rest = SMALLER_UNIT_PATTERN.exec(masked.slice(end));
      if (!rest) break;
      const partMultiplier = multiplierOf(rest[2]);
      const partNumbers = parseNumberCandidates(rest[1]);
      if (partMultiplier >= multiplier || partNumbers.length !== 1) break;
      const part = toCandidate(partNumbers[0], partMultiplier, true);
      candidates = [
        { value: candidates[0].value + part.value, tolerance: part.tolerance },
      ];
      multiplier = partMultiplier;
      end += rest[0].length;
    }

    pattern.lastIndex = end;
    facts.push({
      raw: masked.slice(start, end).trim(),
      hasUnit: unitMatch !== null,
      candidates,
      isPlainInteger:
        unitMatch === null &&
        /^\d+$/.test(raw) &&
        candidates.every((c) => Number.isInteger(c.value)),
    });
  }

  return facts;
}

function shouldIgnore(
  fact: NumericFact,
  options: Required<NumericFactOptions>,
): boolean {
  if (!fact.isPlainInteger) return false;
  const value = fact.candidates[0].value;
  if (value <= options.ignoreIntegersAtMost) return true;
  return options.ignoreYearLike && value >= 1900 && value <= 2100;
}

// Có phần tử nào của mảng đã sắp xếp nằm trong [low, high] không (tìm nhị phân).
function hasValueWithin(sorted: number[], low: number, high: number): boolean {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (sorted[mid] < low) lo = mid + 1;
    else hi = mid;
  }
  return lo < sorted.length && sorted[lo] <= high;
}

function isGrounded(fact: NumericFact, sortedSourceValues: number[]): boolean {
  return fact.candidates.some((c) => {
    const slack = c.tolerance + EPSILON * Math.max(1, Math.abs(c.value));
    return hasValueWithin(sortedSourceValues, c.value - slack, c.value + slack);
  });
}

/**
 * Đối soát câu trả lời với các nguồn (output tool, yêu cầu của user...). Mọi số
 * trong câu trả lời phải khớp (sau chuẩn hoá định dạng/đơn vị, cho phép làm tròn
 * ở số chữ số đã viết) với ít nhất 1 số trong nguồn. Dấu âm bị bỏ qua.
 */
export function verifyNumericFactConsistency(
  answer: string,
  sources: string[],
  options?: NumericFactOptions,
): NumericFactConsistencyResult {
  const resolved = { ...DEFAULT_NUMERIC_FACT_OPTIONS, ...options };

  const sourceValues = sources
    .flatMap((source) => extractNumericFacts(source))
    .flatMap((fact) => fact.candidates.map((c) => c.value))
    .sort((a, b) => a - b);

  const grounded = new Set<string>();
  const ungrounded = new Set<string>();
  for (const fact of extractNumericFacts(answer)) {
    if (shouldIgnore(fact, resolved)) continue;
    (isGrounded(fact, sourceValues) ? grounded : ungrounded).add(fact.raw);
  }

  return {
    isConsistent: ungrounded.size === 0,
    grounded: [...grounded],
    ungrounded: [...ungrounded],
  };
}

const MAX_LISTED_UNGROUNDED_NUMBERS = 5;

/** Câu cảnh báo gắn vào cuối câu trả lời (cùng kiểu với cảnh báo số lượng ở TurnResolverRun). */
export function buildUngroundedNumbersDisclaimer(ungrounded: string[]): string {
  const listed = ungrounded.slice(0, MAX_LISTED_UNGROUNDED_NUMBERS).join(', ');
  const rest = ungrounded.length - MAX_LISTED_UNGROUNDED_NUMBERS;
  const more = rest > 0 ? ` và ${rest} số khác` : '';
  return `⚠️ Một số con số trong câu trả lời (${listed}${more}) không xuất hiện trong kết quả công cụ hay yêu cầu của bạn — có thể do mình tự tính toán/làm tròn; hãy đối chiếu lại trước khi sử dụng.`;
}
