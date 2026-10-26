import { McpToolDto } from '../../../contracts/dtos/mcp.dto';
import { MockProvider, errorResult, textResult } from './mock-provider';

export const MOCK_COMPUTE_PROVIDER_ID = 'compute';

const TOOLS: McpToolDto[] = [
  {
    name: 'run_python',
    description:
      'Thực thi mã Python trong môi trường Sandbox cô lập. Dùng để tính toán ma trận tương quan, phân tích thống kê, xử lý dữ liệu số học và vẽ đồ thị.',
    inputSchema: {
      type: 'object',
      properties: {
        code: { type: 'string', description: 'Mã nguồn Python cần chạy trong sandbox' },
        description: { type: 'string', description: 'Mô tả mục đích tính toán' },
      },
      required: ['code'],
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'run_bash',
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

export function createMockComputeProvider(): MockProvider {
  return {
    id: MOCK_COMPUTE_PROVIDER_ID,
    tools: TOOLS,
    resources: [],
    call: (name: string, args: Record<string, unknown>) => {
      if (name === 'run_python') {
        const code = (args.code as string) ?? '';
        return textResult(
          `[Python Sandbox 3.11 Execution Completed]\n` +
            `Code executed:\n\`\`\`python\n${code.slice(0, 150)}...\n\`\`\`\n` +
            `STDOUT:\n` +
            `-----------------------------------------\n` +
            `Ma trận tương quan (Correlation Matrix):\n` +
            `                      so_luong_hoan  thoi_gian_phan_hoi_phut\n` +
            `so_luong_hoan              1.000000                 0.784512\n` +
            `thoi_gian_phan_hoi_phut    0.784512                 1.000000\n\n` +
            `P-value: 0.00034 (Có ý nghĩa thống kê cao p < 0.01)\n` +
            `Kết luận: Có mối tương quan thuận mạnh (r = 0.785) giữa thời gian phản hồi của nhân viên CSKH và số lượng đơn hàng hoàn. Khi thời gian phản hồi tăng thêm 15 phút, tỷ lệ hoàn đơn có xu hướng tăng 12.4%.`,
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
