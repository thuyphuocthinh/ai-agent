import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';

// AC-6: các hàm orchestration từng quá dài phải giữ thân ≤ 80 dòng (tách thành bước nhỏ).
const ENGINE_DIR = path.resolve(__dirname, '../../engine');
const MAX_BODY_LINES = 80;

interface Target {
  file: string; // tương đối so với engine/
  className: string;
  methods: string[];
}

const TARGETS: readonly Target[] = [
  {
    file: 'supervisor/supervisor.service.ts',
    className: 'SupervisorService',
    methods: ['plan'],
  },
  {
    file: 'loop/react-loop.service.ts',
    className: 'ReactLoopService',
    methods: ['run', 'buildSystemInstruction'],
  },
  {
    file: 'loop/tool-call-executor.ts',
    className: 'ToolCallExecutor',
    methods: ['runToolCall', 'handleToolCall', 'executeTrackedToolCall'],
  },
  {
    file: 'orchestrator/turn/turn-resolver-run.ts',
    className: 'TurnResolverRun',
    methods: ['executeStageBatch', 'delegateRound', 'runPlanningStep'],
  },
  {
    file: 'orchestrator/engines/autonomous.engine.ts',
    className: 'AutonomousEngine',
    methods: ['execute', 'resume'],
  },
  {
    file: 'orchestrator/engines/deterministic.engine.ts',
    className: 'DeterministicEngine',
    methods: ['execute', 'resume'],
  },
];

// Ngoại lệ khai báo kèm lý do, khoá theo "Class.method".
const DECLARED_EXCEPTIONS: Readonly<Record<string, string>> = {};

export function measureMethodBodyLines(
  sourceText: string,
  className: string,
  methodName: string,
): number | undefined {
  const source = ts.createSourceFile(
    'measured.ts',
    sourceText,
    ts.ScriptTarget.Latest,
    true,
  );
  let measured: number | undefined;

  const visit = (node: ts.Node): void => {
    if (ts.isClassDeclaration(node) && node.name?.text === className) {
      for (const member of node.members) {
        if (
          ts.isMethodDeclaration(member) &&
          member.name.getText() === methodName &&
          member.body
        ) {
          const start = source.getLineAndCharacterOfPosition(
            member.body.getStart(),
          ).line;
          const end = source.getLineAndCharacterOfPosition(member.body.getEnd()).line;
          measured = end - start + 1;
        }
      }
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return measured;
}

describe('engine method length (AC-6)', () => {
  describe('measure self-check', () => {
    it('counts the body lines of a class method', () => {
      const source = [
        'class Sample {',
        '  run(): void {',
        '    const a = 1;',
        '    return;',
        '  }',
        '}',
      ].join('\n');
      expect(measureMethodBodyLines(source, 'Sample', 'run')).toBe(4);
    });

    it('returns undefined when the method does not exist', () => {
      expect(measureMethodBodyLines('class A {}', 'A', 'run')).toBeUndefined();
    });
  });

  const cases = TARGETS.flatMap((target) =>
    target.methods.map(
      (method) =>
        [`${target.className}.${method}`, target.file, target.className, method] as const,
    ),
  );

  it.each(cases)(
    '%s has a body of at most 80 lines',
    (qualifiedName, file, className, method) => {
      if (qualifiedName in DECLARED_EXCEPTIONS) return;
      const lines = measureMethodBodyLines(
        fs.readFileSync(path.join(ENGINE_DIR, file), 'utf8'),
        className,
        method,
      );
      expect(lines).toBeDefined();
      expect(lines as number).toBeLessThanOrEqual(MAX_BODY_LINES);
    },
  );
});
