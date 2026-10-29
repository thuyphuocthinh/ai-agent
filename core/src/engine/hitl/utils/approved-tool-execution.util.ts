import { EStepExecutionStatus } from '@agent/core/constants';
import { extractTextFromMcpResult } from '../../../common';
import {
  TOOL_TRACE_PREVIEW_MAX_CHARS,
  formatToolName,
} from '../../../common/tool-trace.util';
import {
  CheckpointResponseDto,
  PendingToolCall,
} from '../../../contracts/dtos/checkpoint.dto';
import { ToolCallTraceDto } from '../../../contracts/dtos/react-loop.dto';
import { IToolProvider } from '../../../contracts/tools/tool-provider.interface';

export interface ApprovedToolExecution {
  resultText: string;
  isError: boolean;
  // Dòng trace của tool vừa chạy (status theo kết quả thật).
  trace: ToolCallTraceDto;
}

// Chạy tool đã được người dùng duyệt: gọi tool thật, đánh dấu checkpoint "đã thực thi" ngay
// sau khi tool chạy (kể cả khi tool trả lỗi) để cron cleanup biết hành động đã chạy, rồi dựng trace.
export async function executeApprovedTool(
  deps: {
    toolProvider: IToolProvider;
    markToolExecuted?: (dto: { id: string }) => Promise<void>;
  },
  checkpoint: Pick<CheckpointResponseDto, 'id' | 'userId' | 'workspaceId'>,
  pendingTool: PendingToolCall,
): Promise<ApprovedToolExecution> {
  const toolResult = await deps.toolProvider.callTool({
    provider: pendingTool.provider,
    name: pendingTool.name,
    args: pendingTool.args,
    ownerId: checkpoint.userId,
    workspaceId: checkpoint.workspaceId,
  });

  const resultText = extractTextFromMcpResult(toolResult);
  await deps.markToolExecuted?.({ id: checkpoint.id });

  const isError = Boolean(toolResult.isError);
  return {
    resultText,
    isError,
    trace: {
      tool: formatToolName(pendingTool.provider, pendingTool.name),
      status: isError ? EStepExecutionStatus.ERROR : EStepExecutionStatus.SUCCESS,
      argsPreview: JSON.stringify(pendingTool.args).slice(
        0,
        TOOL_TRACE_PREVIEW_MAX_CHARS,
      ),
      resultPreview: resultText.slice(0, TOOL_TRACE_PREVIEW_MAX_CHARS),
    },
  };
}
