export enum EApprovalAction {
  APPROVE = 'approve',
  REJECT = 'reject',
  CLARIFY = 'clarify',
  EDIT_AND_APPROVE = 'edit_and_approve',
}

export enum ECheckpointKind {
  APPROVAL = 'approval',
  CLARIFICATION = 'clarification',
}

export enum ECheckpointRiskLevel {
  MEDIUM = 'medium',
  HIGH = 'high',
}

export enum EStepExecutionStatus {
  SUCCESS = 'success',
  ERROR = 'error',
  AWAITING_APPROVAL = 'awaiting_approval',
}

export enum EMessageRole {
  USER = 'user',
  MODEL = 'model',
}

// Loại nội dung dạng object của message HITL (message không phải chữ).
export enum EMessageContentType {
  APPROVAL_REQUEST = 'approval_request',
  CLARIFICATION_REQUEST = 'clarification_request',
}

// Loại event message phát ra từ message sink.
export enum EMessageEventType {
  CREATED = 'created',
  UPDATED = 'updated',
}

export enum ERefreshFormat {
  FORM = 'form',
  JSON = 'json',
}

export enum ESupervisorVerdict {
  CONTINUE = 'continue',
  REPLAN = 'replan',
  FINALIZE = 'finalize',
  DONE = 'done',
}

export enum ECircuitBreaker {
  OPEN = 'open',
  HALF_OPEN = 'halfOpen',
  CLOSED = 'closed',
}

export enum EAgentStreamStepType {
  STEP_START = 'step_start',
  TOOL_CALL = 'tool_call',
  TOOL_RESULT = 'tool_result',
  TOKEN = 'token',
  RESYNC = 'resync',
  DONE = 'done',
}

export enum EAgentStreamStepKind {
  PLANNING = 'planning',
  EXECUTION = 'execution',
  SYNTHESIZE = 'synthesize',
}

export enum EVercelStreamChunkType {
  START = 'start',
  FINISH = 'finish',
  ERROR = 'error',
  START_STEP = 'start-step',
  FINISH_STEP = 'finish-step',
  TEXT_START = 'text-start',
  TEXT_DELTA = 'text-delta',
  TEXT_END = 'text-end',
  DATA_STATUS = 'data-status',
  DATA_PERSONA = 'data-persona',
  DATA_RESYNC = 'data-resync',
  DATA_APPROVAL = 'data-approval',
  DATA_CLARIFICATION = 'data-clarification',
  DATA_REPLY = 'data-reply',
  TOOL_INPUT_AVAILABLE = 'tool-input-available',
  TOOL_OUTPUT_AVAILABLE = 'tool-output-available',
  TOOL_OUTPUT_ERROR = 'tool-output-error',
}

export const STREAM_KEYS = {
  DEFAULT: 'main',
  PLANNING: 'planning',
  SYNTHESIZE: 'synthesize',
} as const;

