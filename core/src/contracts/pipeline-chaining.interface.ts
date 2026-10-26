import { ToolCallTraceDto } from './dtos/react-loop.dto';
import { AnswerResult } from '../engine/orchestrator/orchestration-answer.types';
import { EngineExecutionContext, IExecutionEngine } from './execution-engine.interface';

export const PIPELINE_CHAINING_ENGINE = Symbol.for('PIPELINE_CHAINING_ENGINE');

export enum EPipelineStepType {
  LLM = 'llm',
  REACT_LOOP = 'react_loop',
  CODE_TRANSFORM = 'code_transform',
}

export interface PipelineStepDefinition {
  /**
   * Mã định danh duy nhất của bước (ví dụ: 'step1_extract', 'step2_format', 'step3_synthesize')
   */
  readonly id: string;

  /**
   * Tên hiển thị người dùng hoặc log của bước
   */
  readonly name: string;

  /**
   * Kiểu thực thi: 'react_loop' (mặc định - có thể gọi tools), 'llm' (chỉ sinh văn bản), hoặc 'code_transform'
   */
  readonly type?: EPipelineStepType;

  /**
   * Template prompt cho bước này.
   * Hỗ trợ placeholder:
   * - `{{input}}`: Dữ liệu đầu ra của bước trước (hoặc prompt ban đầu nếu là bước đầu tiên).
   */
  readonly promptTemplate?: string;

  /**
   * Chỉ thị hệ thống (System Prompt) chuyên biệt cho bước này.
   */
  readonly systemPrompt?: string;

  /**
   * Model LLM được cấu hình riêng cho bước này (Model Tiering - SamuraiAI style):
   * Ví dụ: Model rẻ 'gemini-2.0-flash' cho bước trích xuất thô,
   * Model xịn 'claude-3-5-sonnet' hoặc 'gpt-4o' cho bước tổng hợp chiến lược.
   */
  readonly model?: string;

  /**
   * Danh sách công cụ được phép sử dụng ở bước này (Principle of Least Privilege).
   */
  readonly tools?: readonly string[];

  /**
   * Provider gắn liền với bước này (ví dụ: 'google_sheets', 'sql_server', 'compute').
   */
  readonly provider?: string;

  /**
   * Cờ yêu cầu con người phê duyệt trước khi bước này được thực thi (HITL Gate).
   */
  readonly requireHumanApproval?: boolean;

  /**
   * Hàm chuyển đổi dữ liệu tùy biến bằng mã TS (nếu type là 'code_transform').
   */
  readonly transform?: (
    prevOutput: string,
    context: Record<string, unknown>,
  ) => string | Promise<string>;
}

export interface PipelineDefinition {
  /**
   * Mã định danh duy nhất của pipeline (ví dụ: 'weekly-competitor-report')
   */
  readonly id: string;

  /**
   * Tên hiển thị của pipeline
   */
  readonly name: string;

  /**
   * Mô tả tóm tắt mục đích quy trình
   */
  readonly description?: string;

  /**
   * Danh sách các bước tuần tự được thực thi từ trên xuống dưới
   */
  readonly steps: readonly PipelineStepDefinition[];
}

export interface PipelineStepExecutionRecord {
  stepId: string;
  stepName: string;
  modelUsed?: string;
  input: string;
  output: string;
  toolCalls?: ToolCallTraceDto[];
  durationMs?: number;
}

export interface IPipelineChainingEngine extends IExecutionEngine {
  executePipeline(
    pipeline: PipelineDefinition,
    context: EngineExecutionContext,
  ): Promise<AnswerResult>;
}
