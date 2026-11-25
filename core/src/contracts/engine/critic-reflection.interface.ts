import type { Logger } from '@nestjs/common';
import type {
  RunReactLoopResponseDto,
  ToolCallTraceDto,
} from '../dtos/react-loop.dto';
import type { LlmTurnResult } from './llm-strategy.interface';

/**
 * Phán quyết thẩm định từ Response Critic
 */
export enum ECriticVerdict {
  APPROVED = 'APPROVED',
  NEEDS_REFINEMENT = 'NEEDS_REFINEMENT',
}

/**
 * Kết quả thẩm định sự thật số liệu
 */
export interface ICriticEvaluationResult {
  readonly verdict: ECriticVerdict;
  readonly ungroundedNumbers: readonly string[];
  readonly missedQuestionCount: number;
  readonly feedbackPrompt?: string;
}

/**
 * Cấu hình khởi tạo ResponseCriticGate
 */
export interface IResponseCriticGateOptions {
  readonly enabled: boolean;
  readonly maxSteps: number;
  readonly userPrompt: string;
  readonly sendMessage: (
    prompt: string,
    onToken?: (chunk: string) => void,
  ) => Promise<LlmTurnResult>;
  readonly logger: Logger;
}

/**
 * Ngữ cảnh thực thi khi thẩm định câu trả lời tại lượt cuối
 */
export interface ICriticGateContext {
  readonly turn: LlmTurnResult;
  readonly step: number;
  readonly toolCalls: readonly ToolCallTraceDto[];
  readonly selfChecked: boolean;
  readonly onToken?: (chunk: string) => void;
  readonly resync: (text: string) => void;
}

/**
 * Kết quả điều hướng của ResponseCriticGate:
 * - { done: true, response }: Hoàn tất vòng lặp với câu trả lời sạch
 * - { done: false, nextTurn }: LLM quyết định gọi thêm tool -> tiếp tục ReAct loop
 * - undefined: Gate bỏ qua hoặc bị tắt -> nhường luồng cho fallback mặc định
 */
export type CriticGateOutcome =
  | { done: true; response: RunReactLoopResponseDto }
  | { done: false; nextTurn: LlmTurnResult };
