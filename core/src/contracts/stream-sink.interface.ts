import { EStepExecutionStatus } from '@agent/core/constants';

export const DEFAULT_STREAM_KEY = 'main';
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
  type:
    | 'tool_call'
    | 'tool_result'
    | 'done'
    | 'token'
    | 'resync'
    | 'step_start';
  tool?: string;
  status?: EStepExecutionStatus;
  resultPreview?: string;
  argsPreview?: string;
  text?: string;
  label?: string;
  kind?: 'synthesize';
}

export interface IStreamSink {
  emitStep(context: AgentStreamContext, step: AgentStreamStep): Promise<void>;
  emitToken(context: AgentStreamContext, token: string): Promise<void>;
  flush(): Promise<void>;
}
