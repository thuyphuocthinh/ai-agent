import { McpToolDto } from '../../../contracts/dtos/mcp.dto';
import { ToolContext } from '../../../contracts/tools/tool-provider.interface';
import { MockProvider, errorResult, textResult } from './mock-provider';
import { DockerPythonSandboxRunner } from './docker-python-sandbox.runner';
import { IArtifactTmpManager } from '../../../contracts/storage/artifact-tmp.interface';

export const MOCK_COMPUTE_PROVIDER_ID = 'compute';

const TOOLS: McpToolDto[] = [
  {
    name: 'run_python',
    authType: 'SYSTEM',
    description:
      'Thực thi mã Python trong môi trường Sandbox cô lập. BẮT BUỘC: Để xuất ma trận kết quả chuyển đổi cho các tool khác sử dụng, script PHẢI ghi file ra đĩa bằng lệnh: with open(f"/tmp/artifacts/{turnId}/transformed_matrix.json", "w", encoding="utf-8") as f: json.dump(matrix, f) hoặc in ra STDOUT bằng print(f"TRANSFORMED_{len(matrix)}_ROWS"). Tuyệt đối không chỉ viết tên biến ở dòng cuối.',
    inputSchema: {
      type: 'object',
      properties: {
        code: { type: 'string', description: 'Mã nguồn Python cần chạy trong sandbox' },
        description: { type: 'string', description: 'Mô tả mục đích tính toán' },
        turnId: { type: 'string', description: 'ID của turn hội thoại để định vị file tạm' },
      },
      required: ['code'],
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'run_bash',
    authType: 'SYSTEM',
    description: 'Thực thi lệnh shell/bash trong môi trường sandbox cô lập.',
    inputSchema: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'Lệnh bash cần chạy' },
      },
      required: ['command'],
    },
    annotations: { readOnlyHint: true },
  },
];

export function createMockComputeProvider(
  runnerOrTmpManager?: DockerPythonSandboxRunner | IArtifactTmpManager,
): MockProvider {
  const runner =
    runnerOrTmpManager && 'runPython' in runnerOrTmpManager
      ? (runnerOrTmpManager as DockerPythonSandboxRunner)
      : runnerOrTmpManager
      ? new DockerPythonSandboxRunner(runnerOrTmpManager as IArtifactTmpManager)
      : undefined;

  return {
    id: MOCK_COMPUTE_PROVIDER_ID,
    tools: TOOLS,
    resources: [],
    call: async (
      name: string,
      args: Record<string, unknown>,
      context?: ToolContext,
    ) => {
      if (name === 'run_python') {
        const code = (args.code as string) ?? '';
        const turnId =
          typeof args.turnId === 'string' && args.turnId.trim()
            ? args.turnId.trim()
            : typeof args.turn_id === 'string' && args.turn_id.trim()
            ? args.turn_id.trim()
            : context?.messageId ?? context?.workspaceId ?? 'turn-default';

        if (runner) {
          const res = await runner.runPython(code, turnId);
          if (res.success) {
            return textResult(
              `[Python Sandbox 3.11 Execution Completed]\n` +
                `STDOUT:\n-----------------------------------------\n` +
                `${res.stdout || '(no stdout output)'}\n` +
                (res.stderr ? `STDERR:\n${res.stderr}\n` : ''),
            );
          } else {
            return errorResult(
              `[Python Sandbox Error]\n${res.stderr || res.error || 'Execution failed'}\nSTDOUT:\n${res.stdout}`,
            );
          }
        }

        // Fallback giả lập nếu runner không được truyền vào
        return textResult(
          `[Python Sandbox 3.11 Execution Completed]\n` +
            `Code executed:\n\`\`\`python\n${code.slice(0, 150)}...\n\`\`\`\n` +
            `STDOUT:\n` +
            `-----------------------------------------\n` +
            `Output: Python executed successfully.`,
        );
      }

      if (name === 'run_bash') {
        const command = (args.command as string) ?? '';
        return textResult(`[Bash Sandbox Output]\nCommand: ${command}\nStatus: SUCCESS\nOutput: Done.`);
      }

      return errorResult(`Tool "${name}" không tồn tại trong compute provider`);
    },
  };
}
