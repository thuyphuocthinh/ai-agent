export enum EPolicyStatus {
  AUTO_APPROVED = 'AUTO_APPROVED',
  USER_CONFIRMATION_REQUIRED = 'USER_CONFIRMATION_REQUIRED',
  EXCEEDS_AI_AUTHORITY = 'EXCEEDS_AI_AUTHORITY',
  POLICY_VIOLATION = 'POLICY_VIOLATION',
}

export enum EActionType {
  REFUND_ORDER = 'REFUND_ORDER',
  CANCEL_ORDER = 'CANCEL_ORDER',
  UPDATE_ORDER = 'UPDATE_ORDER',
  EXECUTE_WRITE_QUERY = 'EXECUTE_WRITE_QUERY',
  SEND_EXTERNAL_MESSAGE = 'SEND_EXTERNAL_MESSAGE',
}

export enum ERiskLevel {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  CRITICAL = 'critical',
}

export enum EEscalationReason {
  AMOUNT_EXCEEDED = 'AMOUNT_EXCEEDED',
  SUSPICIOUS_CUSTOMER = 'SUSPICIOUS_CUSTOMER',
  POLICY_BLOCKED = 'POLICY_BLOCKED',
  MANUAL_REQUEST = 'MANUAL_REQUEST',
}

export enum EEscalationStatus {
  OPEN = 'OPEN',
  IN_REVIEW = 'IN_REVIEW',
  RESOLVED = 'RESOLVED',
  REJECTED = 'REJECTED',
}

export enum EIdempotencyStatus {
  IN_PROGRESS = 'IN_PROGRESS',
  EXECUTED = 'EXECUTED',
  FAILED = 'FAILED',
}

export enum EReviewerType {
  AI = 'AI',
  HUMAN = 'HUMAN',
}

export enum EPreflightStatus {
  READY = 'READY',
  PROVIDER_NOT_CONNECTED = 'PROVIDER_NOT_CONNECTED',
  MISSING_OAUTH_SCOPE = 'MISSING_OAUTH_SCOPE',
}

export enum EProviderAuthType {
  SYSTEM = 'SYSTEM',
  OAUTH2 = 'OAUTH2',
  API_KEY = 'API_KEY',
  PUBLIC = 'PUBLIC',
}

export enum EPolicyVerdict {
  ALLOW = 'ALLOW',
  DENY = 'DENY',
  REQUIRE_APPROVAL = 'REQUIRE_APPROVAL',
  ESCALATE = 'ESCALATE',
}

export enum EPolicySeverity {
  CRITICAL = 'CRITICAL',
  HIGH = 'HIGH',
  MEDIUM = 'MEDIUM',
  LOW = 'LOW',
}

export enum EOrderStatus {
  PENDING = 'PENDING',
  PROCESSING = 'PROCESSING',
  SHIPPING = 'SHIPPING',
  DELIVERED = 'DELIVERED',
  CANCELLED = 'CANCELLED',
  REFUNDED = 'REFUNDED',
}

export const AUDIT_STORE = Symbol.for('AUDIT_STORE');
export const IDEMPOTENCY_STORE = Symbol.for('IDEMPOTENCY_STORE');
export const ESCALATION_STORE = Symbol.for('ESCALATION_STORE');
export const POLICY_CONFIG_LOADER = Symbol.for('POLICY_CONFIG_LOADER');

export interface ISecurityConfig {
  autoApprovalThreshold: number;
  supervisorThreshold: number;
  maxRefundDays: number;
  idempotencyTtlSeconds: number;
  idempotencyRetentionSeconds: number;
  maxRecentAuditLogs: number;
}

export const DEFAULT_SECURITY_CONFIG: ISecurityConfig = {
  autoApprovalThreshold: 200_000,
  supervisorThreshold: 2_000_000,
  maxRefundDays: 7,
  idempotencyTtlSeconds: 120,
  idempotencyRetentionSeconds: 300,
  maxRecentAuditLogs: 100,
};
