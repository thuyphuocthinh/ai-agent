/**
 * Luật kiến trúc cho core/src (chạy bằng `pnpm --filter @agent/core arch`).
 *
 * Thứ tự lớp, chỉ được import từ trái sang phải (lớp sau import lớp trước):
 *   constants → contracts → common → infrastructure → memory / security → engine → api → (root)
 *
 * - `contracts`: chỉ chứa interface/DTO/token, không được biết implementation nào.
 * - `common`: tiện ích thuần, không phụ thuộc infrastructure/engine.
 * - `memory` và `security` là hai lớp song song, không import lẫn nhau.
 */
const ROOT_FILES = 'orchestration\\.module|index|main';

const forbidImports = (name, comment, from, toLayers) => ({
  name,
  comment,
  severity: 'error',
  from: { path: `^src/${from}/` },
  to: { path: `^src/(${toLayers})(/|\\.ts$)` },
});

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'no-circular',
      comment:
        'Cấm vòng phụ thuộc (kể cả import type-only). Tách type dùng chung ra file riêng hoặc đảo chiều bằng port/token trong contracts.',
      severity: 'error',
      from: {},
      to: { circular: true },
    },
    forbidImports(
      'constants-is-leaf',
      'constants không được import bất kỳ lớp nào khác.',
      'constants',
      `contracts|common|infrastructure|memory|security|engine|api|${ROOT_FILES}`,
    ),
    forbidImports(
      'contracts-no-upward',
      'contracts chỉ được phụ thuộc constants.',
      'contracts',
      `common|infrastructure|memory|security|engine|api|${ROOT_FILES}`,
    ),
    forbidImports(
      'common-no-upward',
      'common chỉ được phụ thuộc constants và contracts.',
      'common',
      `infrastructure|memory|security|engine|api|${ROOT_FILES}`,
    ),
    forbidImports(
      'infrastructure-no-upward',
      'infrastructure không được import memory/security/engine/api.',
      'infrastructure',
      `memory|security|engine|api|${ROOT_FILES}`,
    ),
    forbidImports(
      'memory-no-upward',
      'memory không được import engine/api và không import security.',
      'memory',
      `security|engine|api|${ROOT_FILES}`,
    ),
    forbidImports(
      'security-no-upward',
      'security không được import engine/api và không import memory.',
      'security',
      `memory|engine|api|${ROOT_FILES}`,
    ),
    forbidImports(
      'engine-no-upward',
      'engine không được import api hoặc root module.',
      'engine',
      `api|${ROOT_FILES}`,
    ),
    forbidImports(
      'api-no-root',
      'api không được import root module.',
      'api',
      ROOT_FILES,
    ),
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    exclude: { path: ['\\.spec\\.ts$', '^src/tests/', '__mocks__'] },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.json' },
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default', 'types'],
    },
    reporterOptions: { text: { highlightFocused: true } },
  },
};
