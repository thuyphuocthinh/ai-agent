// Hiệu chỉnh ngưỡng nạp skill tự động: nhận điểm khớp thật của một bộ prompt có
// nhãn rồi cho biết ngưỡng nào phân loại đúng toàn bộ (hàm thuần, dùng bởi
// scripts/skill-match-eval.ts với embedding thật).

export interface LabelledPrompt {
  prompt: string;
  /** Slug skill phải được nạp; `null` = không skill nào được nạp. */
  expected: string | null;
}

export interface SkillScore {
  slug: string;
  score: number;
}

export interface ScoredPrompt extends LabelledPrompt {
  /** Điểm của MỌI skill ứng viên, sắp giảm dần. */
  ranking: readonly SkillScore[];
}

export interface CalibrationFailure {
  prompt: string;
  expected: string | null;
  predicted: string | null;
  topScore: number | null;
}

export interface ThresholdRange {
  /** Ngưỡng phải LỚN HƠN giá trị này (điểm cao nhất của các prompt âm tính). */
  lowerExclusive: number;
  /** Ngưỡng phải NHỎ HƠN hoặc BẰNG giá trị này (điểm thấp nhất của skill đúng ở prompt dương tính). */
  upperInclusive: number;
  recommended: number;
}

// Skill được nạp khi điểm cao nhất ≥ ngưỡng; ngược lại không nạp gì.
function predict(row: ScoredPrompt, threshold: number): string | null {
  const top = row.ranking[0];
  return top && top.score >= threshold ? top.slug : null;
}

export function findFailures(
  rows: readonly ScoredPrompt[],
  threshold: number,
): CalibrationFailure[] {
  return rows
    .map((row) => ({
      prompt: row.prompt,
      expected: row.expected,
      predicted: predict(row, threshold),
      topScore: row.ranking[0]?.score ?? null,
    }))
    .filter((r) => r.predicted !== r.expected);
}

// Khoảng ngưỡng phân loại đúng toàn bộ bộ prompt; null nếu không có ngưỡng nào
// (VD một prompt dương tính có skill đúng không đứng đầu).
export function findPassingThresholdRange(
  rows: readonly ScoredPrompt[],
): ThresholdRange | null {
  let lowerExclusive = 0;
  let upperInclusive = 1;

  for (const row of rows) {
    const top = row.ranking[0];
    if (row.expected === null) {
      lowerExclusive = Math.max(lowerExclusive, top?.score ?? 0);
    } else {
      if (!top || top.slug !== row.expected) return null;
      upperInclusive = Math.min(upperInclusive, top.score);
    }
  }

  if (lowerExclusive >= upperInclusive) return null;
  return {
    lowerExclusive,
    upperInclusive,
    recommended: (lowerExclusive + upperInclusive) / 2,
  };
}
