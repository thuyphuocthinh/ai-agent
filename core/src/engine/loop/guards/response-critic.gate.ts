import { Logger } from '@nestjs/common';
import { DEFAULT_EMPTY_ANSWER } from '../../../constants/engine-literals.constant';
import {
  ECriticVerdict,
  type IResponseCriticGateOptions,
  type ICriticGateContext,
  type CriticGateOutcome,
} from '../../../contracts/engine/critic-reflection.interface';
import { ResponseCriticEvaluatorUtil } from '../reflection/response-critic-evaluator.util';

export class ResponseCriticGate {
  private checked = false;

  constructor(private readonly options: IResponseCriticGateOptions) {}

  /**
   * Thẩm định và điều hướng câu trả lời cuối:
   * - Trả về CriticGateOutcome nếu Critic xử lý (Done hoặc Nudge next turn).
   * - Trả về undefined nếu Critic bị tắt hoặc không đủ điều kiện can thiệp (nhường luồng cho fallback).
   */
  public async evaluateOutcome(
    context: ICriticGateContext,
  ): Promise<CriticGateOutcome | undefined> {
    // 1. Kiểm tra cờ bật/tắt (Feature Toggle từ DTO)
    if (!this.options.enabled) {
      return undefined;
    }

    // 2. Điều kiện can thiệp: Chưa check lần nào, có tool calls, và còn ngân sách bước chạy
    const hasBudget = context.step < this.options.maxSteps - 1;
    if (this.checked || context.selfChecked || context.toolCalls.length === 0 || !hasBudget) {
      return undefined;
    }

    const answerBeforeCheck = context.turn.text;
    const critic = ResponseCriticEvaluatorUtil.evaluate(
      this.options.userPrompt,
      answerBeforeCheck || '',
      context.toolCalls,
    );

    // 3. Nếu Critic Approved -> 100% Fact-grounded, nhường luồng cho bước chốt câu trả lời
    if (critic.verdict === ECriticVerdict.APPROVED) {
      this.options.logger.log(
        `run() Critic APPROVED: 100% Fact-grounded at step=${context.step}`,
      );
      return undefined;
    }

    // 4. Nếu Critic phát hiện ảo giác số liệu -> Kích hoạt 1 lượt tự sửa
    if (critic.feedbackPrompt) {
      this.checked = true;
      this.options.logger.warn(
        `run() Critic REJECTED at step=${context.step} — Ungrounded numbers: ${critic.ungroundedNumbers.join(', ')}`,
      );

      const criticTurn = await this.options.sendMessage(critic.feedbackPrompt, context.onToken);

      // Model nhận ra thiếu dữ liệu và quyết định gọi thêm tool -> Tiếp tục ReAct loop
      if (criticTurn.toolCalls && criticTurn.toolCalls.length > 0) {
        context.resync('');
        return { done: false, nextTurn: criticTurn };
      }

      // Model tự sửa văn bản sạch sẽ -> Trả về câu trả lời đã tinh chỉnh
      const refinedAnswer = criticTurn.text || answerBeforeCheck || DEFAULT_EMPTY_ANSWER;
      context.resync(refinedAnswer);
      return {
        done: true,
        response: { answer: refinedAnswer, toolCalls: [...context.toolCalls] },
      };
    }

    return undefined;
  }
}
