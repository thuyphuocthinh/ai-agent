import { EActionType, EPolicyStatus } from '../constants/security.constants';

export type ConditionOperator =
  | 'EQUALS'
  | 'NOT_EQUALS'
  | 'GREATER_THAN'
  | 'GREATER_THAN_OR_EQUAL'
  | 'LESS_THAN'
  | 'LESS_THAN_OR_EQUAL'
  | 'IN'
  | 'IS_TRUE'
  | 'IS_FALSE';

export interface PolicyCondition {
  field: string;
  operator: ConditionOperator;
  value?: unknown;
}

export interface PolicyOutcome {
  status: EPolicyStatus;
  reason: string;
  thresholdLimit?: number;
}

export interface PolicyRuleDefinition {
  id: string;
  name: string;
  action: EActionType | string;
  priority: number;
  condition: PolicyCondition;
  outcome: PolicyOutcome;
}

export interface PolicyConfigFile {
  version: string;
  description?: string;
  rules: PolicyRuleDefinition[];
}
