import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';

// AC-3: file trong engine/ không được hardcode prompt/message dài. Văn bản tĩnh nằm ở
// constants/prompts/*.prompt.ts, văn bản có nội suy nằm ở utils/*-prompt.util.ts / *-message.util.ts.

const ENGINE_DIR = path.resolve(__dirname, '../../engine');
const MIN_LITERAL_LENGTH = 70;

// File được phép chứa văn bản dài vì đó chính là nhiệm vụ của file.
const DESIGNATED_FILE_PATTERNS: readonly RegExp[] = [
  /-prompt\.util\.ts$/,
  /-message\.util\.ts$/,
  /\.data\.ts$/,
];

// Ngoại lệ khai báo kèm lý do (đường dẫn tương đối so với engine/).
const DECLARED_EXCEPTIONS: Readonly<Record<string, string>> = {
  'orchestrator/engines/hybrid-execution-router.util.ts':
    'Nhãn lý do định tuyến (ghi log/hiển thị), không gửi cho LLM; đứng ngay cạnh điều kiện quyết định và đã được hybrid-execution-router.util.spec.ts khoá nguyên văn.',
};

interface HardcodedLiteral {
  line: number;
  length: number;
  preview: string;
}

function isInsideLoggerCall(node: ts.Node): boolean {
  for (let current = node.parent; current; current = current.parent) {
    if (ts.isCallExpression(current)) {
      const callee = current.expression.getText();
      if (/(^|\.)logger\.\w+$/i.test(callee)) return true;
    }
  }
  return false;
}

// Thông báo lỗi lập trình (throw new Error(...)) dành cho developer, không phải prompt/message gửi đi.
function isInsideErrorConstruction(node: ts.Node): boolean {
  for (let current = node.parent; current; current = current.parent) {
    if (
      ts.isNewExpression(current) &&
      /Error$|Exception$/.test(current.expression.getText())
    ) {
      return true;
    }
  }
  return false;
}

function isModuleSpecifier(node: ts.Node): boolean {
  const parent = node.parent;
  return (
    !!parent &&
    (ts.isImportDeclaration(parent) ||
      ts.isExportDeclaration(parent) ||
      ts.isLiteralTypeNode(parent))
  );
}

// Độ dài phần văn bản tĩnh của literal (template expression chỉ tính phần chữ, bỏ ${...}).
function staticTextLength(node: ts.Node): number | undefined {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return node.text.length;
  }
  if (ts.isTemplateExpression(node)) {
    return (
      node.head.text.length +
      node.templateSpans.reduce((sum, span) => sum + span.literal.text.length, 0)
    );
  }
  return undefined;
}

export function findHardcodedLiterals(
  sourceText: string,
  fileName: string,
): HardcodedLiteral[] {
  const source = ts.createSourceFile(
    fileName,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
  );
  const found: HardcodedLiteral[] = [];

  const visit = (node: ts.Node): void => {
    const length = staticTextLength(node);
    if (
      length !== undefined &&
      length >= MIN_LITERAL_LENGTH &&
      !isModuleSpecifier(node) &&
      !isInsideLoggerCall(node) &&
      !isInsideErrorConstruction(node)
    ) {
      found.push({
        line: source.getLineAndCharacterOfPosition(node.getStart()).line + 1,
        length,
        preview: node.getText().slice(0, 60),
      });
      // template expression lồng nhau đã được tính ở literal ngoài cùng
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

function listEngineSourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return listEngineSourceFiles(full);
    return entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts')
      ? [full]
      : [];
  });
}

describe('no hardcoded prompts in engine (AC-3)', () => {
  describe('detector self-check', () => {
    const longText = 'a'.repeat(MIN_LITERAL_LENGTH);

    it('flags a long string literal', () => {
      const result = findHardcodedLiterals(
        `const prompt = '${longText}';`,
        'fixture.ts',
      );
      expect(result).toHaveLength(1);
    });

    it('flags a long template literal by its static text only', () => {
      const result = findHardcodedLiterals(
        `const prompt = \`${longText} \${x}\`;`,
        'fixture.ts',
      );
      expect(result).toHaveLength(1);
    });

    it('ignores short literals and interpolation-heavy templates', () => {
      expect(
        findHardcodedLiterals(`const a = 'short'; const b = \`\${x}\${y}\`;`, 'f.ts'),
      ).toHaveLength(0);
    });

    it('ignores logger calls', () => {
      expect(
        findHardcodedLiterals(
          `this.logger.warn('${longText}'); logger.log(\`${longText} \${x}\`);`,
          'f.ts',
        ),
      ).toHaveLength(0);
    });

    it('ignores developer-facing error messages', () => {
      expect(
        findHardcodedLiterals(`throw new Error('${longText}');`, 'f.ts'),
      ).toHaveLength(0);
    });

    it('ignores import/export specifiers', () => {
      expect(
        findHardcodedLiterals(`import { a } from '${longText}';`, 'f.ts'),
      ).toHaveLength(0);
    });
  });

  it('keeps long prompt/message text out of engine files', () => {
    const violations = listEngineSourceFiles(ENGINE_DIR)
      .map((file) => ({
        relative: path.relative(ENGINE_DIR, file).split(path.sep).join('/'),
        file,
      }))
      .filter(
        ({ relative }) =>
          !DESIGNATED_FILE_PATTERNS.some((pattern) => pattern.test(relative)) &&
          !(relative in DECLARED_EXCEPTIONS),
      )
      .flatMap(({ relative, file }) =>
        findHardcodedLiterals(fs.readFileSync(file, 'utf8'), file).map(
          (hit) => `${relative}:${hit.line} (${hit.length} chars) ${hit.preview}`,
        ),
      );

    expect(violations).toEqual([]);
  });
});
