import { Test, TestingModule } from '@nestjs/testing';
import { ReactLoopService } from './react-loop.service';
import { LlmStrategyFactory } from '../strategy/llm-strategy.factory';
import { TOOL_PROVIDER, STREAM_SINK } from '../../contracts';
import { CircuitBreakerService } from '../../infrastructure/resilience/circuit-breaker.service';
import { AgentCancellationService } from '../cancellation/agent-cancellation.service';
import { MemoryManagerService } from '../../memory/memory-manager.service';
import { RunReactLoopRequestDto } from '../../contracts/dtos/react-loop.dto';

jest.mock('@agent/core/common', () => ({
  extractTextFromMcpResult: jest.fn(
    (result?: { content?: { type: string; text?: string }[] }) => {
      if (!result?.content?.length) return '';
      return result.content
        .filter((c) => c.type === 'text' && c.text)
        .map((c) => c.text)
        .join('\n');
    },
  ),
}));

describe('Multi-Provider Single Agent ReAct Loop (AC-1 & AC-2)', () => {
  let service: ReactLoopService;

  const mockMcpClient = {
    getTools: jest.fn(),
    callTool: jest.fn(),
    getResources: jest.fn(),
    readResource: jest.fn(),
  };
  const mockAgentStream = { emitStep: jest.fn() };
  const mockSession = { sendMessage: jest.fn() };
  const mockStrategy = {
    id: 'gemini',
    startChat: jest.fn().mockReturnValue(mockSession),
    generateStructured: jest.fn(),
  };
  const mockLlmFactory = {
    resolve: jest
      .fn()
      .mockReturnValue({ strategy: mockStrategy, model: 'gemini-2.0-flash' }),
  };
  const mockCircuitBreaker = {
    run: jest.fn((_key: string, action: () => Promise<unknown>) => action()),
  };
  const mockCancellation = { isCancelled: jest.fn().mockResolvedValue(false) };
  const mockMemoryManager = {
    buildBudget: jest.fn().mockReturnValue({
      dataCharBudget: 10000,
      historyCharBudget: 5000,
      memoryCharBudget: 2000,
      toolResultCharBudget: 10000,
    }),
  };

  const baseDto: RunReactLoopRequestDto = {
    prompt: 'So sánh dữ liệu SQL và Slack',
    provider: 'sql_server',
    userId: 'user-1',
    channelId: 'channel-1',
    messageId: 'reply-1',
    history: [],
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    mockAgentStream.emitStep.mockResolvedValue(undefined);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReactLoopService,
        { provide: TOOL_PROVIDER, useValue: mockMcpClient },
        { provide: LlmStrategyFactory, useValue: mockLlmFactory },
        { provide: STREAM_SINK, useValue: mockAgentStream },
        { provide: CircuitBreakerService, useValue: mockCircuitBreaker },
        { provide: AgentCancellationService, useValue: mockCancellation },
        { provide: MemoryManagerService, useValue: mockMemoryManager },
      ],
    }).compile();

    service = module.get<ReactLoopService>(ReactLoopService);
  });

  it('tải công cụ từ nhiều provider song song và cung cấp đầy đủ cho LLM', async () => {
    mockMcpClient.getTools.mockImplementation(async (provider: string) => {
      if (provider === 'sql_server') {
        return [{ name: 'read_query', description: 'SQL', inputSchema: {} }];
      }
      if (provider === 'slack') {
        return [{ name: 'post_message', description: 'Slack', inputSchema: {} }];
      }
      return [];
    });

    mockSession.sendMessage.mockResolvedValueOnce({
      text: 'Đã hoàn tất',
      toolCalls: [],
    });

    await service.run({
      ...baseDto,
      providers: ['sql_server', 'slack'],
    });

    expect(mockMcpClient.getTools).toHaveBeenCalledWith(
      'sql_server',
      baseDto.prompt,
      expect.any(AbortSignal),
      undefined,
    );
    expect(mockMcpClient.getTools).toHaveBeenCalledWith(
      'slack',
      baseDto.prompt,
      expect.any(AbortSignal),
      undefined,
    );

    expect(mockStrategy.startChat).toHaveBeenCalledWith(
      expect.objectContaining({
        tools: expect.arrayContaining([
          expect.objectContaining({ name: 'read_query' }),
          expect.objectContaining({ name: 'post_message' }),
        ]),
      }),
    );
  });

  it('tự động gắn tiền tố (namespacing) khi các provider có công cụ trùng tên để tránh collision', async () => {
    mockMcpClient.getTools.mockImplementation(async (provider: string) => {
      if (provider === 'sql_server') {
        return [{ name: 'notify', description: 'SQL Alert', inputSchema: {} }];
      }
      if (provider === 'slack') {
        return [{ name: 'notify', description: 'Slack Ping', inputSchema: {} }];
      }
      return [];
    });

    mockSession.sendMessage.mockResolvedValueOnce({
      text: 'Đã gửi thông báo',
      toolCalls: [],
    });

    await service.run({
      ...baseDto,
      providers: ['sql_server', 'slack'],
    });

    expect(mockStrategy.startChat).toHaveBeenCalledWith(
      expect.objectContaining({
        tools: expect.arrayContaining([
          expect.objectContaining({ name: 'sql_server__notify' }),
          expect.objectContaining({ name: 'slack__notify' }),
        ]),
      }),
    );
  });

  it('điều phối lệnh gọi công cụ về đúng MCP provider tương ứng và loại bỏ tiền tố namespacing', async () => {
    mockMcpClient.getTools.mockImplementation(async (provider: string) => {
      if (provider === 'sql_server') {
        return [{ name: 'notify', description: 'SQL Alert', inputSchema: {} }];
      }
      if (provider === 'slack') {
        return [{ name: 'notify', description: 'Slack Ping', inputSchema: {} }];
      }
      return [];
    });

    mockSession.sendMessage
      .mockResolvedValueOnce({
        text: '',
        toolCalls: [
          {
            id: 'call_1',
            name: 'slack__notify',
            args: { text: 'Sự cố thanh toán' },
          },
        ],
      })
      .mockResolvedValueOnce({
        text: 'Đã bắn tin Slack',
        toolCalls: [],
      });

    mockMcpClient.callTool.mockResolvedValueOnce({
      content: [{ type: 'text', text: 'Sent OK' }],
    });

    const result = await service.run({
      ...baseDto,
      providers: ['sql_server', 'slack'],
    });

    expect(mockMcpClient.callTool).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'slack',
        name: 'notify',
        args: { text: 'Sự cố thanh toán' },
      }),
      expect.any(AbortSignal),
    );
    expect(result.answer).toBe('Đã bắn tin Slack');
  });
});
