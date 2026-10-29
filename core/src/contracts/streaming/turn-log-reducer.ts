import { EAgentStreamStepType, EStepExecutionStatus } from '@agent/core/constants';
import {
  ExecutedStepDto,
  IMessageToolCallItem,
} from '../dtos/message-client.dto';
import { DEFAULT_STREAM_KEY } from './stream-sink.interface';
import { ETurnLogEntryKind, TurnLogEntry } from './turn-event-log.interface';

export interface ReducedTurnLog {
  partialText: string;
  steps: ExecutedStepDto[];
  toolCalls: IMessageToolCallItem[];
}

/**
 * Tổng hợp phần dở dang của 1 turn từ event log (dùng khi turn bị huỷ/lỗi để lưu
 * lại những gì đã sinh ra). Chỉ nhìn stream mặc định cho text của câu trả lời;
 * stream phụ (multi-agent) không phải câu trả lời cuối.
 */
export function reduceTurnLog(entries: TurnLogEntry[]): ReducedTurnLog {
  const reduced: ReducedTurnLog = { partialText: '', steps: [], toolCalls: [] };

  for (const entry of entries) {
    if (entry.kind !== ETurnLogEntryKind.STEP) continue;
    const { context, step } = entry;
    const isDefaultStream = (context.streamKey ?? DEFAULT_STREAM_KEY) === DEFAULT_STREAM_KEY;

    switch (step.type) {
      case EAgentStreamStepType.TOKEN:
        if (isDefaultStream) reduced.partialText += step.text ?? '';
        break;
      case EAgentStreamStepType.RESYNC:
        if (isDefaultStream && step.text) reduced.partialText = step.text;
        break;
      case EAgentStreamStepType.STEP_START:
        reduced.steps.push({
          agent: step.persona?.role || step.label || 'agent',
          task: step.label || '',
          persona: step.persona,
          toolCalls: [],
        });
        break;
      case EAgentStreamStepType.TOOL_CALL:
      case EAgentStreamStepType.TOOL_RESULT:
        if (step.tool) {
          mergeToolCall(reduced.toolCalls, {
            toolCallId: step.toolCallId,
            tool: step.tool,
            status: step.status ?? EStepExecutionStatus.SUCCESS,
            argsPreview: step.argsPreview,
            resultPreview: step.resultPreview,
          });
        }
        break;
    }
  }
  return reduced;
}

// Có toolCallId thì ghép theo id. Không có id (producer cũ): kết quả ghép vào
// call gần nhất cùng tên tool mà chưa có kết quả.
function mergeToolCall(
  toolCalls: IMessageToolCallItem[],
  incoming: IMessageToolCallItem,
): void {
  for (let i = toolCalls.length - 1; i >= 0; i--) {
    const existing = toolCalls[i];
    const matches = incoming.toolCallId
      ? existing.toolCallId === incoming.toolCallId
      : incoming.resultPreview !== undefined &&
        !existing.toolCallId &&
        existing.tool === incoming.tool &&
        existing.resultPreview === undefined;
    if (!matches) continue;

    const defined = Object.fromEntries(
      Object.entries(incoming).filter(([, value]) => value !== undefined),
    );
    toolCalls[i] = { ...existing, ...defined };
    return;
  }
  toolCalls.push(incoming);
}
