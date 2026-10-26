import { ToolCallTraceDto } from './dtos/react-loop.dto';
import { AnswerResult } from '../engine/orchestrator/orchestration-answer.types';
import { EngineExecutionContext, IExecutionEngine } from './execution-engine.interface';

export const PARALLEL_FANOUT_ENGINE = Symbol.for('PARALLEL_FANOUT_ENGINE');

export const PARALLEL_FANOUT_REGEX =
  /(quét|kiểm tra|tìm kiếm|tra cứu|so sánh)\s+(đồng thời|cùng lúc|song song)|cùng lúc trên (\d+|nhiều)|fan-out|cào đồng thời/i;

export interface FanoutWorkerDefinition {
  /**
   * Mã định danh duy nhất của worker
   */
  readonly id: string;

  /**
   * Tên mô tả ngắn của nguồn dữ liệu / nhiệm vụ độc lập worker này đảm nhận
   * (ví dụ: 'Shopee', 'Lazada', 'Tiki')
   */
  readonly name: string;

  /**
   * Prompt / nhiệm vụ riêng dành cho worker này
   * Hỗ trợ placeholder `{{input}}` được thay bằng prompt gốc của người dùng
   */
  readonly prompt?: string;

  /**
   * Provider MCP gắn liền với worker này (ví dụ: 'shopee_mcp', 'lazada_mcp')
   */
  readonly provider?: string;

  /**
   * Danh sách công cụ được phép sử dụng (Principle of Least Privilege)
   */
  readonly tools?: readonly string[];
}

export interface FanoutDefinition {
  /**
   * Mã định danh duy nhất của cụm Fan-out
   */
  readonly id: string;

  /**
   * Tên hiển thị của cụm Fan-out
   */
  readonly name: string;

  /**
   * Mô tả mục đích fan-out
   */
  readonly description?: string;

  /**
   * Danh sách các workers chạy đồng thời (Promise.all)
   */
  readonly workers: readonly FanoutWorkerDefinition[];

  /**
   * Số worker chạy song song tối đa cùng lúc (concurrency guard, mặc định: toàn bộ)
   * Hữu ích khi có quá nhiều worker (ví dụ: 10 sources) để tránh quá tải LLM rate-limit
   */
  readonly maxConcurrency?: number;

  /**
   * Model LLM dành cho Aggregator — nên là Model xịn (claude-3-5-sonnet, gpt-4o)
   * để tổng hợp, so sánh và viết báo cáo cuối chất lượng cao
   */
  readonly aggregatorModel?: string;

  /**
   * System prompt cho Aggregator Agent
   */
  readonly aggregatorSystemPrompt?: string;
}

export interface FanoutWorkerResult {
  workerId: string;
  workerName: string;
  success: boolean;
  output: string;
  toolCalls?: ToolCallTraceDto[];
  error?: string;
  durationMs?: number;
}

export interface IParallelFanoutEngine extends IExecutionEngine {
  executeFanout(
    fanout: FanoutDefinition,
    context: EngineExecutionContext,
  ): Promise<AnswerResult>;
}
