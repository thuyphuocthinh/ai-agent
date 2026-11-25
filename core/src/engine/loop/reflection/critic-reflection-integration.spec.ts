import { Logger } from '@nestjs/common';
import { ResponseCriticGate } from '../guards/response-critic.gate';
import {
  ICriticGateContext,
  IResponseCriticGateOptions,
  ECriticVerdict,
} from '../../../contracts/engine/critic-reflection.interface';
import { ToolCallTraceDto } from '../../../contracts/dtos/react-loop.dto';

describe('Critic Reflection & Self-Correction Integration Specs', () => {
  let mockLogger: jest.Mocked<Logger>;
  let mockSendMessage: jest.Mock;
  let mockResync: jest.Mock;

  beforeEach(() => {
    mockLogger = {
      log: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    } as unknown as jest.Mocked<Logger>;
    mockSendMessage = jest.fn();
    mockResync = jest.fn();
  });

  const createGate = (enabled = true, maxSteps = 10) =>
    new ResponseCriticGate({
      enabled,
      maxSteps,
      userPrompt: 'Doanh thu tháng 1 là bao nhiêu?',
      sendMessage: mockSendMessage,
      logger: mockLogger,
    });

  it('Feature Toggle: khi enableCriticReflection = false, gate bypass 100% không can thiệp', async () => {
    const gate = createGate(false);
    const context: ICriticGateContext = {
      turn: {
        text: 'Doanh thu là 999999999 tỷ (ảo giác hoàn toàn).',
        toolCalls: [],
      },
      step: 1,
      toolCalls: [
        {
          tool: 'sql_server.execute_query',
          status: 'success' as any,
          resultPreview: 'Revenue: 50000000 VND',
        },
      ],
      selfChecked: false,
      resync: mockResync,
    };

    const outcome = await gate.evaluateOutcome(context);

    expect(outcome).toBeUndefined();
    expect(mockSendMessage).not.toHaveBeenCalled();
    expect(mockLogger.warn).not.toHaveBeenCalled();
  });

  it('Fact-Grounded: khi số liệu khớp 100% với dữ liệu tool trả về, gate approve và cho phép kết thúc', async () => {
    const gate = createGate(true);
    const context: ICriticGateContext = {
      turn: {
        text: 'Doanh thu tháng 1 ghi nhận được là 50000000 VND theo báo cáo.',
        toolCalls: [],
      },
      step: 1,
      toolCalls: [
        {
          tool: 'sql_server.execute_query',
          status: 'success' as any,
          resultPreview: 'Revenue: 50000000 VND',
        },
      ],
      selfChecked: false,
      resync: mockResync,
    };

    const outcome = await gate.evaluateOutcome(context);

    // Gate ghi log Approved và trả về undefined để luồng tiếp tục hoàn tất sạch sẽ
    expect(outcome).toBeUndefined();
    expect(mockLogger.log).toHaveBeenCalledWith(
      expect.stringContaining('Critic APPROVED: 100% Fact-grounded'),
    );
    expect(mockSendMessage).not.toHaveBeenCalled();
  });

  it('Hallucination Detection & Retry: khi phát hiện số liệu lạ, gửi feedback và tiếp tục ReAct loop nếu LLM gọi thêm tool', async () => {
    const gate = createGate(true);
    const context: ICriticGateContext = {
      turn: {
        text: 'Doanh thu là 999999999 VND và lợi nhuận 45%.',
        toolCalls: [],
      },
      step: 1,
      toolCalls: [
        {
          tool: 'sql_server.execute_query',
          status: 'success' as any,
          resultPreview: 'Revenue: 50000000 VND',
        },
      ],
      selfChecked: false,
      resync: mockResync,
    };

    // LLM nhận ra thiếu dữ liệu nên quyết định gọi thêm công cụ truy vấn
    mockSendMessage.mockResolvedValueOnce({
      text: '',
      toolCalls: [
        {
          id: 'call_2',
          name: 'sql_server.query_profit',
          args: { month: 1 },
        },
      ],
    });

    const outcome = await gate.evaluateOutcome(context);

    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Critic REJECTED at step=1'),
    );
    expect(mockSendMessage).toHaveBeenCalledWith(
      expect.stringContaining('CẢNH BÁO ẢO GIÁC SỐ LIỆU'),
      undefined,
    );
    expect(mockResync).toHaveBeenCalledWith('');
    expect(outcome).toEqual({
      done: false,
      nextTurn: {
        text: '',
        toolCalls: [
          {
            id: 'call_2',
            name: 'sql_server.query_profit',
            args: { month: 1 },
          },
        ],
      },
    });
  });

  it('Self-Correction Text Refinement: khi LLM tự sửa loại bỏ số liệu ảo giác, trả về câu trả lời đã tinh chỉnh', async () => {
    const gate = createGate(true);
    const toolCalls: ToolCallTraceDto[] = [
      {
        tool: 'sql_server.execute_query',
        status: 'success' as any,
        resultPreview: 'Revenue: 50000000 VND',
      },
    ];

    const context: ICriticGateContext = {
      turn: {
        text: 'Doanh thu là 999999999 VND (ảo giác).',
        toolCalls: [],
      },
      step: 1,
      toolCalls,
      selfChecked: false,
      resync: mockResync,
    };

    // LLM sửa lại text sạch dựa trên dữ liệu thật
    mockSendMessage.mockResolvedValueOnce({
      text: 'Doanh thu chính xác là 50000000 VND theo cơ sở dữ liệu.',
      toolCalls: [],
    });

    const outcome = await gate.evaluateOutcome(context);

    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Critic REJECTED at step=1'),
    );
    expect(mockResync).toHaveBeenCalledWith(
      'Doanh thu chính xác là 50000000 VND theo cơ sở dữ liệu.',
    );
    expect(outcome).toEqual({
      done: true,
      response: {
        answer: 'Doanh thu chính xác là 50000000 VND theo cơ sở dữ liệu.',
        toolCalls,
      },
    });
  });
});
