/**
 * Hiệu chỉnh ngưỡng nạp skill tự động bằng embedding THẬT và skill thật trong DB.
 *
 * Chạy: `pnpm --filter @agent/core skill:eval` (cần DATABASE_URL, OPENAI_API_KEY và đã
 * `pnpm seed:skills`). In điểm khớp của từng prompt có nhãn
 * (scripts/skill-match-eval.prompts.json), khoảng ngưỡng phân loại đúng toàn bộ và
 * ngưỡng khuyến nghị; thoát khác 0 nếu ngưỡng hiện hành (SKILL_AUTOLOAD_MIN_SCORE hoặc
 * mặc định) phân loại sai ít nhất một prompt.
 */
import { config as loadEnv } from 'dotenv';

loadEnv({ path: ['.env', '../.env'] });

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readSkillAutoloadConfig } from '../src/common/skill-autoload.config';
import { OpenAiEmbeddingProvider } from '../src/infrastructure/embedding/openai-embedding.provider';
import { PrismaService } from '../src/infrastructure/database/prisma.service';
import { SkillCatalogService } from '../src/memory/skill/skill-catalog.service';
import { SkillMatchService } from '../src/memory/skill/skill-match.service';
import {
  findFailures,
  findPassingThresholdRange,
  LabelledPrompt,
  ScoredPrompt,
} from '../src/memory/skill/skill-match-calibration.util';

const TENANT_ID = 'default';

async function scorePrompts(
  matcher: SkillMatchService,
  labelled: LabelledPrompt[],
): Promise<ScoredPrompt[]> {
  const rows: ScoredPrompt[] = [];
  for (const { prompt, expected } of labelled) {
    const matches = await matcher.match(prompt, TENANT_ID);
    rows.push({
      prompt,
      expected,
      ranking: matches.map((m) => ({ slug: m.skill.slug, score: m.score })),
    });
  }
  return rows;
}

function printTable(rows: ScoredPrompt[]): void {
  for (const row of rows) {
    const [first, second] = row.ranking;
    const fmt = (s?: { slug: string; score: number }) =>
      s ? `${s.slug} ${s.score.toFixed(3)}` : '-';
    console.log(
      `${(row.expected ?? '(không skill)').padEnd(20)} | ${fmt(first).padEnd(30)} | ${fmt(second).padEnd(30)} | ${row.prompt}`,
    );
  }
}

async function main(): Promise<void> {
  const threshold = readSkillAutoloadConfig().minScore;
  const labelled: LabelledPrompt[] = JSON.parse(
    readFileSync(join(__dirname, 'skill-match-eval.prompts.json'), 'utf8'),
  );

  // Lấy điểm của MỌI skill: hạ ngưỡng xuống gần 0, nới số skill và timeout.
  process.env.SKILL_AUTOLOAD_MIN_SCORE = '0.0001';
  process.env.SKILL_AUTOLOAD_MAX_SKILLS = '100';
  process.env.SKILL_AUTOLOAD_TIMEOUT_MS = '30000';

  const prisma = new PrismaService();
  await prisma.$connect();
  try {
    const matcher = new SkillMatchService(
      new SkillCatalogService(prisma),
      new OpenAiEmbeddingProvider(),
    );
    const rows = await scorePrompts(matcher, labelled);

    console.log('Kỳ vọng              | Top 1                          | Top 2                          | Prompt');
    printTable(rows);

    const range = findPassingThresholdRange(rows);
    console.log(
      range
        ? `\nKhoảng ngưỡng đúng toàn bộ: (${range.lowerExclusive.toFixed(3)}, ${range.upperInclusive.toFixed(3)}] — khuyến nghị ${range.recommended.toFixed(3)}`
        : '\nKHÔNG có ngưỡng nào phân loại đúng toàn bộ bộ prompt (xem các dòng sai ở trên).',
    );

    const failures = findFailures(rows, threshold);
    console.log(`\nNgưỡng hiện hành ${threshold}: ${failures.length === 0 ? 'ĐÚNG toàn bộ' : `SAI ${failures.length} prompt`}`);
    failures.forEach((f) =>
      console.log(`  - "${f.prompt}": mong đợi ${f.expected ?? '(không)'}, nạp ${f.predicted ?? '(không)'} (điểm cao nhất ${f.topScore?.toFixed(3) ?? '-'})`),
    );
    process.exitCode = failures.length === 0 ? 0 : 1;
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error('skill:eval thất bại:', (error as Error).message);
  process.exit(1);
});
