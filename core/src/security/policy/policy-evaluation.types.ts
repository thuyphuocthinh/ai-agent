import type { LlmStrategy } from '../../engine/strategy/llm-strategy.interface';
import {
  EPolicySeverity,
  EPolicyVerdict,
} from '../constants/security.constants';
import type { TargetResourceRef } from '../escalation/escalation.types';

export type { TargetResourceRef };

/**
 * Đoạn trích điều khoản quy chế doanh nghiệp lưu trữ trong Policy Corpus.
 */
export interface PolicyChunk {
  id: string;
  domain: string; // "devops" | "finance" | "hr" | "support" | "legal" | "general"
  title: string;
  content: string;
  severity?: EPolicySeverity;
  embedding?: number[];
  metadata?: Record<string, unknown>;
}

/**
 * Bản ghi trích đoạn chính sách kèm điểm số tương đồng cosine hoặc heuristic.
 */
export interface ScoredPolicyChunk {
  chunk: PolicyChunk;
  score: number;
}

/**
 * Cấu hình tùy chọn khi tìm kiếm chính sách trong PolicyCorpusService.
 */
export interface PolicySearchOptions {
  domain?: string;
  limit?: number;
  minScore?: number;
}

/**
 * Ngữ cảnh đầu vào phục vụ thẩm định chính sách ngữ nghĩa.
 */
export interface PolicyEvaluationContext {
  userId: string;
  provider: string;
  toolName: string;
  args: Record<string, unknown>;
  userIntent?: string;
  targetResource?: TargetResourceRef;
  metadata?: Record<string, unknown>;
}

/**
 * Cấu hình thực thi của SemanticPolicyEvaluatorService.
 */
export interface SemanticEvaluationOptions {
  strategy?: LlmStrategy;
  model?: string;
  signal?: AbortSignal;
}

/**
 * Kết quả thẩm định chính sách ngữ nghĩa chuẩn hóa.
 */
export interface SemanticEvaluationResult {
  verdict: EPolicyVerdict;
  reason: string;
  citedRuleId?: string;
  citedRuleTitle?: string;
  suggestedAction?: string;
  targetResource?: TargetResourceRef;
  confidence?: number;
}
