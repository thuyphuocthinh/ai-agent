export interface PersonaData {
  role?: string;
  goal?: string;
  constraints?: string[];
  tone?: string;
}

export interface StatusData {
  label?: string;
  kind?: string;
}

export interface ApprovalData {
  messageId?: string;
  id?: string;
  toolName?: string;
  tool?: string;
  args?: Record<string, unknown>;
  parameters?: Record<string, unknown>;
  friendlySummary?: string;
  summary?: string;
  impactAssessment?: string;
  preview?: string;
}

export interface UiChunk {
  type: string;
  id?: string;
  delta?: string;
  text?: string;
  data?: unknown;
  toolName?: string;
  toolCallId?: string;
  input?: unknown;
  output?: unknown;
  errorText?: string;
  title?: string;
  toolMetadata?: {
    friendlySummary?: string;
    streamKey?: string;
  };
}

export interface ChatTurnResponse {
  sessionId: string;
  chunks: AsyncIterable<UiChunk>;
}

export interface CoreChatClientOptions {
  coreUrl?: string;
  fetchFn?: typeof fetch;
}
