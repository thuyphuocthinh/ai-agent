import { CONV_ARTIFACT_STATUS } from '@agent/core/constants';

export const CONVERSATION_ARTIFACT_STORE = Symbol.for(
  'CONVERSATION_ARTIFACT_STORE',
);

export type ConversationArtifactMimeType = 'application/json' | 'text/plain';

export interface ConversationArtifactRecord {
  readonly filename: string;
  readonly conversationId: string;
  readonly sourceTool: string;
  readonly mimeType: ConversationArtifactMimeType;
  readonly recordCount: number;
  readonly byteSize: number;
  readonly sample: unknown[];
}

export interface ConversationArtifactEnvelope {
  readonly status: typeof CONV_ARTIFACT_STATUS;
  readonly filename: string;
  readonly conversationId: string;
  readonly sourceTool: string;
  readonly mimeType: ConversationArtifactMimeType;
  readonly recordCount: number;
  readonly byteSize: number;
  readonly sample: unknown[];
  readonly note: string;
}

/**
 * Kho lưu trữ artifact tạm theo conversationId (tách biệt hoàn toàn khỏi
 * ArtifactTmpManagerService của Python Sandbox), TTL 4 giờ.
 */
export interface IConversationArtifactStore {
  save(params: {
    conversationId: string;
    sourceTool: string;
    rawText: string;
  }): Promise<ConversationArtifactRecord>;

  read(conversationId: string, filename: string): Promise<string>;

  cleanExpired(ttlMs?: number): Promise<number>;
}
