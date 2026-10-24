import type { TargetResourceRef } from './escalation/escalation.types';
import {
  EEscalationStatus,
  EReviewerType,
} from './constants/security.constants';

export interface PromptInspectionResult {
  safe: boolean;
  riskLevel: 'low' | 'medium' | 'high';
  reason?: string;
  matchedPattern?: string;
  sanitizedPrompt?: string;
}

export type PolicyActionStatus =
  | 'AUTO_APPROVED'
  | 'USER_CONFIRMATION_REQUIRED'
  | 'EXCEEDS_AI_AUTHORITY'
  | 'POLICY_VIOLATION';

export interface PolicyEvaluationResult {
  allowed: boolean;
  status: PolicyActionStatus;
  reason?: string;
  thresholdLimit?: number;
  currentAmount?: number;
}

export interface EscalationTicket {
  ticketId: string;
  conversationId: string;
  userId: string;
  targetResource?: TargetResourceRef;
  orderId?: string;
  requestedAmount?: number;
  reason: string;
  handoverSummary: string;
  createdAt: Date;
  status: EEscalationStatus;
  metadata?: Record<string, unknown>;
}

export interface AuditLogEntry {
  id: string;
  timestamp: Date;
  userId: string;
  tenantId?: string;
  actionType: string;
  targetResource?: TargetResourceRef;
  entityId?: string;
  amount?: number;
  evaluationStatus: string;
  reviewer: EReviewerType | 'AI' | 'HUMAN';
  idempotencyKey?: string;
  metadata?: Record<string, unknown>;
}

export interface ProviderCapabilityCheckResult {
  ready: boolean;
  reason?: 'READY' | 'PROVIDER_NOT_CONNECTED' | 'MISSING_OAUTH_SCOPE';
  provider?: string;
  missingScopes?: string[];
  connectUrl?: string;
  reauthUrl?: string;
}

export interface UserConnectionProfile {
  provider: string;
  isConnected: boolean;
  grantedScopes?: string[];
  connectUrl?: string;
}

/**
 * Interface cho phép cắm rút nguồn dữ liệu kết nối OAuth của người dùng
 * (Database, Token Vault, hoặc Mock Memory).
 */
export interface IUserConnectionResolver {
  getUserConnection(
    userId: string,
    provider: string,
  ): Promise<UserConnectionProfile | null> | UserConnectionProfile | null;
}
