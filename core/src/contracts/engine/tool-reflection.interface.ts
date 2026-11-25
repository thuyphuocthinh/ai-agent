export enum EToolFailureCategory {
  MISSING_REQUIRED_ARG = 'MISSING_REQUIRED_ARG',
  INVALID_ARG_TYPE = 'INVALID_ARG_TYPE',
  RESOURCE_NOT_FOUND = 'RESOURCE_NOT_FOUND',
  QUERY_SYNTAX_ERROR = 'QUERY_SYNTAX_ERROR',
  AUTH_OR_PERMISSION = 'AUTH_OR_PERMISSION',
  UNKNOWN = 'UNKNOWN',
}

export interface IToolFailureReflectionContext {
  readonly toolName: string;
  readonly displayName: string;
  readonly rawErrorMessage: string;
  readonly args: Record<string, unknown>;
  readonly consecutiveFailures: number;
  readonly maxRetries: number;
}

export interface IToolFailureDiagnostic {
  readonly category: EToolFailureCategory;
  readonly rootCauseDescription: string;
  readonly actionableGuidance: string;
  readonly canRetryWithAdjustment: boolean;
}

export interface IToolDiagnosticStrategy {
  readonly category: EToolFailureCategory;
  canHandle(context: IToolFailureReflectionContext): boolean;
  diagnose(context: IToolFailureReflectionContext): IToolFailureDiagnostic;
}
