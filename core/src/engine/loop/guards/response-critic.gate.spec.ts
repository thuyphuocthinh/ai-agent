import { Logger } from '@nestjs/common';
import { ResponseCriticGate } from './response-critic.gate';
import {
  ICriticGateContext,
  IResponseCriticGateOptions,
} from '../../../contracts/engine/critic-reflection.interface';
import { ResponseCriticEvaluatorUtil } from '../reflection/response-critic-evaluator.util';
import { ECriticVerdict } from '../../../contracts/engine/critic-reflection.interface';

describe('ResponseCriticGate', () => {
  let mockLogger: jest.Mocked<Logger>;
  let mockSendMessage: jest.Mock;
  let mockResync: jest.Mock;

  const createGate = (enabled = true, maxSteps = 10): ResponseCriticGate => {
    mockLogger = {
      log: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    } as unknown as jest.Mocked<Logger>;

    mockSendMessage = jest.fn();

    const options: IResponseCriticGateOptions = {
      enabled,
      maxSteps,
      userPrompt: 'Test user prompt',
      sendMessage: mockSendMessage,
      logger: mockLogger,
    };

    return new ResponseCriticGate(options);
  };

  const createContext = (
    step = 1,
    selfChecked = false,
    toolCallsCount = 1,
  ): ICriticGateContext => {
    mockResync = jest.fn();
    return {
      turn: { text: 'Answer text with numbers', toolCalls: [] },
      step,
      toolCalls: toolCallsCount > 0 ? [{ tool: 'test', status: 'success' as any }] : [],
      selfChecked,
      resync: mockResync,
    };
  };

  it('should return undefined when disabled', async () => {
    const gate = createGate(false);
    const context = createContext();

    const result = await gate.evaluateOutcome(context);
    expect(result).toBeUndefined();
    expect(mockSendMessage).not.toHaveBeenCalled();
  });

  it('should return undefined when toolCalls is empty', async () => {
    const gate = createGate(true);
    const context = createContext(1, false, 0);

    const result = await gate.evaluateOutcome(context);
    expect(result).toBeUndefined();
  });

  it('should return undefined when no budget (step >= maxSteps - 1)', async () => {
    const gate = createGate(true, 5);
    const context = createContext(4); // maxSteps - 1

    const result = await gate.evaluateOutcome(context);
    expect(result).toBeUndefined();
  });

  it('should approve and return undefined when critic verdict is APPROVED (letting loop complete)', async () => {
    const gate = createGate(true);
    const context = createContext();

    jest.spyOn(ResponseCriticEvaluatorUtil, 'evaluate').mockReturnValueOnce({
      verdict: ECriticVerdict.APPROVED,
      ungroundedNumbers: [],
      missedQuestionCount: 0,
    });

    const result = await gate.evaluateOutcome(context);
    expect(result).toBeUndefined();
    expect(mockLogger.log).toHaveBeenCalledWith(expect.stringContaining('Critic APPROVED'));
  });

  it('should reject, send feedback, and return done: false when LLM responds with tool calls', async () => {
    const gate = createGate(true);
    const context = createContext();

    jest.spyOn(ResponseCriticEvaluatorUtil, 'evaluate').mockReturnValueOnce({
      verdict: ECriticVerdict.NEEDS_REFINEMENT,
      ungroundedNumbers: ['9999'],
      missedQuestionCount: 0,
      feedbackPrompt: 'Critic feedback prompt',
    });

    mockSendMessage.mockResolvedValueOnce({
      text: '',
      toolCalls: [{ id: 'call_1', name: 'retry_tool', args: {} }],
    });

    const result = await gate.evaluateOutcome(context);
    expect(result).toBeDefined();
    expect(result?.done).toBe(false);
    if (result && !result.done) {
      expect(result.nextTurn.toolCalls.length).toBe(1);
    }
    expect(mockSendMessage).toHaveBeenCalledWith('Critic feedback prompt', undefined);
    expect(mockResync).toHaveBeenCalledWith('');
  });

  it('should reject, send feedback, and return refined answer when LLM self-corrects text', async () => {
    const gate = createGate(true);
    const context = createContext();

    jest.spyOn(ResponseCriticEvaluatorUtil, 'evaluate').mockReturnValueOnce({
      verdict: ECriticVerdict.NEEDS_REFINEMENT,
      ungroundedNumbers: ['9999'],
      missedQuestionCount: 0,
      feedbackPrompt: 'Critic feedback prompt',
    });

    mockSendMessage.mockResolvedValueOnce({
      text: 'Corrected text without ungrounded numbers',
      toolCalls: [],
    });

    const result = await gate.evaluateOutcome(context);
    expect(result).toBeDefined();
    expect(result?.done).toBe(true);
    if (result && result.done) {
      expect(result.response.answer).toBe('Corrected text without ungrounded numbers');
    }
    expect(mockResync).toHaveBeenCalledWith('Corrected text without ungrounded numbers');
  });
});
