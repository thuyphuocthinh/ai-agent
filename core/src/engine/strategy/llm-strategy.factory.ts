import { Injectable } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import {
  LLM_MODEL_REGISTRY,
  ORCHESTRATION_ERROR,
  type LlmStrategyId,
} from '@agent/core/constants';
import { GeminiStrategy } from './gemini/gemini.strategy';
import { OpenAiStrategy } from './openai/openai.strategy';
import { AnthropicStrategy } from './anthropic/anthropic.strategy';
import { DeepSeekStrategy } from './deepseek/deepseek.strategy';
import { MockStrategy } from './mock/mock.strategy';
import { LlmStrategy } from '../../contracts/engine/llm-strategy.interface';

/**
 * Strategy Pattern — 1 điểm truy cập duy nhất để lấy đúng LlmStrategy +
 * tên model thật theo "model id" người dùng chọn (VD 'gemini-2.0-flash',
 * 'gpt-4o-mini', 'claude-haiku', 'deepseek-chat'). `ReactLoopService`/`SupervisorService`
 * chỉ gọi `resolve(modelId)`, không tự biết/import SDK provider nào.
 *
 * Hỗ trợ Auto-detection (Heuristic): Tự suy luận provider khi người dùng truyền
 * tên model tự do (chưa khai báo trong LLM_MODEL_REGISTRY).
 */
@Injectable()
export class LlmStrategyFactory {
  private readonly strategies: Record<LlmStrategyId | 'mock', LlmStrategy>;

  constructor(
    private readonly gemini: GeminiStrategy,
    private readonly openai: OpenAiStrategy,
    private readonly anthropic: AnthropicStrategy,
    private readonly deepseek: DeepSeekStrategy,
    private readonly mock: MockStrategy,
  ) {
    this.strategies = {
      gemini: this.gemini,
      openai: this.openai,
      anthropic: this.anthropic,
      deepseek: this.deepseek,
      mock: this.mock,
    };
  }

  resolve(modelId: string): { strategy: LlmStrategy; model: string } {
    if (process.env.LOAD_TEST_MODE === 'true') {
      return { strategy: this.strategies['mock'], model: 'mock-model' };
    }

    // 1. Kiểm tra Exact Match trong Registry (ưu tiên cấu hình chi tiết giá token, context)
    const entry = LLM_MODEL_REGISTRY[modelId];
    if (entry) {
      const strategy = this.strategies[entry.strategyId];
      if (!strategy) {
        throw new RpcException(ORCHESTRATION_ERROR.LLM_PROVIDER_NOT_CONFIGURED);
      }
      return { strategy, model: entry.model };
    }

    // 2. Heuristic Auto-Detection nếu người dùng truyền mã model tự do
    const inferredStrategyId = this.inferStrategyId(modelId);
    if (inferredStrategyId && this.strategies[inferredStrategyId]) {
      return {
        strategy: this.strategies[inferredStrategyId],
        model: modelId,
      };
    }

    throw new RpcException(ORCHESTRATION_ERROR.UNKNOWN_LLM_MODEL);
  }

  private inferStrategyId(modelId: string): LlmStrategyId | null {
    const id = modelId.toLowerCase();
    if (id.includes('deepseek')) {
      return 'deepseek';
    }
    if (
      id.startsWith('gpt') ||
      id.startsWith('o1') ||
      id.startsWith('o3') ||
      id.startsWith('openai/')
    ) {
      return 'openai';
    }
    if (id.startsWith('claude') || id.startsWith('anthropic/')) {
      return 'anthropic';
    }
    if (id.startsWith('gemini') || id.startsWith('google/')) {
      return 'gemini';
    }
    return null;
  }
}
