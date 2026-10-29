/**
 * Clarification Types & Contracts
 * Định nghĩa cấu trúc câu hỏi làm rõ (Ambiguity Clarification HITL)
 * khi Agent phát hiện dữ liệu mơ hồ hoặc có nhiều lựa chọn tương đương.
 */

export interface IClarificationCandidate {
  readonly id: string;
  readonly label: string;
  readonly description?: string;
  readonly value?: string | Record<string, unknown>;
}

export interface IClarificationQuestion {
  readonly question: string;
  readonly parameterName?: string;
  readonly candidates: readonly IClarificationCandidate[];
  readonly allowCustomInput?: boolean;
}

export interface ClarificationResolutionPayload {
  readonly checkpointId: string;
  readonly selectedCandidateId?: string;
  readonly customAnswer?: string;
}

export interface ClarificationCheckpointData {
  readonly question: string;
  readonly candidates: readonly IClarificationCandidate[];
  readonly originalPrompt: string;
  readonly parameterName?: string;
}
