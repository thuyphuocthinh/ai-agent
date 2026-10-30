import type { ZodTypeAny } from 'zod';
import { EPipelineStepFailurePolicy, EPipelineStepType } from './pipeline-chaining.interface';

export const DETERMINISTIC_ENGINE = Symbol.for('DETERMINISTIC_ENGINE');

/**
 * Kiểu node trong đồ thị Deterministic
 */
export enum EDeterministicNodeType {
  /** Node đơn bước (chạy 1 vòng ReAct với persona/tools định sẵn) - thay thế WorkflowRunner */
  SINGLE = 'single',
  /** Node chuỗi tuần tự (chạy tuần tự các bước truyền output sang input) - thay thế PipelineChaining */
  SEQUENCE = 'sequence',
  /** Node chạy song song Fork-Join (chạy N workers đồng thời rồi tổng hợp) - thay thế ParallelFanout */
  PARALLEL = 'parallel',
  /** Node rẽ nhánh điều kiện IF/ELSE */
  BRANCH = 'branch',
}

/**
 * Cấu hình thực thi một Node dạng Single trong đồ thị
 */
export interface DeterministicSingleNodeConfig {
  readonly id: string;
  readonly name: string;
  readonly systemPrompt: string;
  readonly tools?: readonly string[];
  readonly skills?: readonly string[];
  readonly model?: string;
  readonly provider?: string;
  readonly requireHumanApprovalFor?: readonly string[];
}

/**
 * Cấu hình thực thi một bước đơn lẻ trong chuỗi Sequence
 */
export interface DeterministicStepConfig {
  readonly id: string;
  readonly name: string;
  readonly type?: EPipelineStepType;
  readonly promptTemplate?: string;
  readonly systemPrompt?: string;
  readonly model?: string;
  readonly tools?: readonly string[];
  readonly skills?: readonly string[];
  readonly provider?: string;
  readonly outputSchema?: ZodTypeAny | Record<string, unknown>;
  readonly condition?: (output: string, context: Record<string, unknown>) => string | boolean;
  readonly branchMap?: Record<string, string>;
  readonly defaultNextStepId?: string;
  readonly failurePolicy?: EPipelineStepFailurePolicy;
  readonly maxStepRetries?: number;
  readonly transform?: (prevOutput: string, context: Record<string, unknown>) => string | Promise<string>;
}

/**
 * Cấu hình một worker trong Node Parallel (Fork-Join)
 */
export interface DeterministicWorkerConfig {
  readonly id: string;
  readonly name: string;
  readonly prompt?: string;
  readonly provider?: string;
  readonly tools?: readonly string[];
  readonly model?: string;
}

/**
 * Cấu hình Node Parallel (Fork-Join)
 */
export interface DeterministicParallelConfig {
  readonly id: string;
  readonly name: string;
  readonly workers: readonly DeterministicWorkerConfig[];
  readonly maxConcurrency?: number;
  readonly aggregatorModel?: string;
  readonly aggregatorPrompt?: string;
}

/**
 * Node thực thi tổng quát trong Deterministic Execution Graph
 */
export type DeterministicGraphNode =
  | {
      readonly kind: EDeterministicNodeType.SINGLE;
      readonly config: DeterministicSingleNodeConfig;
    }
  | {
      readonly kind: EDeterministicNodeType.SEQUENCE;
      readonly steps: readonly DeterministicStepConfig[];
    }
  | {
      readonly kind: EDeterministicNodeType.PARALLEL;
      readonly config: DeterministicParallelConfig;
    };

/**
 * Định nghĩa hoàn chỉnh của một Deterministic Graph
 */
export interface DeterministicGraphDefinition {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  readonly rootNode: DeterministicGraphNode;
  readonly metadata?: Record<string, unknown>;
}
