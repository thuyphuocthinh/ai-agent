import {
  EStepExecutionStatus,
  EAgentStreamStepType,
  EAgentStreamStepKind,
  STREAM_KEYS,
} from '@agent/core/constants';
import { PersonaDto } from '../dtos/supervisor.dto';

export const DEFAULT_STREAM_KEY = STREAM_KEYS.DEFAULT;
export const STREAM_SINK = Symbol('STREAM_SINK');

export interface AgentStreamContext {
  userId: string;
  conversationId?: string;
  channelId?: string; // Backward compatibility alias for conversationId
  messageId: string;
  sessionType?: string;
  channelType?: string; // Backward compatibility alias for sessionType
  streamKey?: string;
}

export interface AgentStreamStep {
  type: EAgentStreamStepType | `${EAgentStreamStepType}`;
  tool?: string;
  status?: EStepExecutionStatus;
  resultPreview?: string;
  argsPreview?: string;
  text?: string;
  label?: string;
  kind?: EAgentStreamStepKind | `${EAgentStreamStepKind}`;
  // Định danh duy nhất của 1 lần gọi tool, dùng chung cho cặp tool_call /
  // tool_result — để client ghép đúng kết quả với lệnh gọi khi cùng 1 tool bị
  // gọi nhiều lần trong 1 turn. Sink cũ bỏ qua field này.
  toolCallId?: string;
  // Persona của bước vừa bắt đầu (chỉ có ở step_start của 1 delegation).
  persona?: PersonaDto;
  // Mô tả hành động thân thiện hướng người dùng (thay vì câu lệnh SQL hay payload thô).
  friendlySummary?: string;
}

export interface IStreamSink {
  emitStep(context: AgentStreamContext, step: AgentStreamStep): Promise<void>;
  emitToken(context: AgentStreamContext, token: string): Promise<void>;
  flush(): Promise<void>;
}
