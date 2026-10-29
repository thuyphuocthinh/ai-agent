import { SubAgentSpawnerService } from './sub-agent-spawner.service';
import { ReactLoopService } from '../../loop/react-loop.service';
import { AgentCancellationService } from '../../cancellation/agent-cancellation.service';
import { TurnCancelledError } from '../../loop/errors/turn-cancelled.error';
import { RunReactLoopRequestDto } from '../../../contracts/dtos/react-loop.dto';

describe('SubAgentSpawnerService', () => {
  let spawner: SubAgentSpawnerService;
  let mockReactLoop: jest.Mocked<ReactLoopService>;
  let mockCancellation: jest.Mocked<AgentCancellationService>;

  beforeEach(() => {
    mockReactLoop = {
      run: jest.fn().mockResolvedValue({
        answer: 'Tóm tắt tài liệu hoàn tất: Dữ liệu chính xác.',
        toolCalls: [],
      }),
    } as unknown as jest.Mocked<ReactLoopService>;

    mockCancellation = {
      isCancelled: jest.fn().mockResolvedValue(false),
    } as unknown as jest.Mocked<AgentCancellationService>;

    spawner = new SubAgentSpawnerService(mockReactLoop, mockCancellation);
  });

  it('khởi tạo sub-agent cô lập và trả về kết quả thành công', async () => {
    const res = await spawner.spawn({
      task: 'Tóm tắt báo cáo tài chính Q3',
      parentMessageId: 'msg-parent-123',
      userId: 'user-1',
      channelId: 'chan-1',
    });

    expect(res.success).toBe(true);
    expect(res.result).toContain('Tóm tắt tài liệu hoàn tất');
    expect(mockReactLoop.run).toHaveBeenCalledTimes(1);

    const callArg = mockReactLoop.run.mock.calls[0][0] as RunReactLoopRequestDto;
    // Kiểm tra tính cô lập của sub-agent
    expect(callArg.history).toEqual([]);
    expect(callArg.messageId).toContain('msg-parent-123:sub-');
    expect(callArg.persona?.role).toBe('Isolated Sub-Agent Worker');
  });

  it('đính kèm ngữ cảnh phụ trợ vào prompt của sub-agent khi được cung cấp', async () => {
    await spawner.spawn({
      task: 'Trích xuất mã hợp đồng',
      context: 'HỢP ĐỒNG SỐ 999-ABC',
      parentMessageId: 'msg-parent-123',
      userId: 'user-1',
      channelId: 'chan-1',
    });

    const callArg = mockReactLoop.run.mock.calls[0][0] as RunReactLoopRequestDto;
    expect(callArg.prompt).toContain('HỢP ĐỒNG SỐ 999-ABC');
    expect(callArg.prompt).toContain('Trích xuất mã hợp đồng');
  });

  it('ném TurnCancelledError khi lượt chạy đã bị hủy', async () => {
    mockCancellation.isCancelled.mockResolvedValue(true);

    await expect(
      spawner.spawn({
        task: 'Nhiệm vụ dài',
        parentMessageId: 'msg-parent-cancelled',
        userId: 'user-1',
        channelId: 'chan-1',
      }),
    ).rejects.toThrow(TurnCancelledError);
  });

  it('bắt lỗi nhẹ nhàng và trả về success=false khi sub-agent gặp ngoại lệ thông thường', async () => {
    mockReactLoop.run.mockRejectedValue(new Error('LLM Rate Limit exceeded'));

    const res = await spawner.spawn({
      task: 'Nhiệm vụ lỗi',
      parentMessageId: 'msg-parent-123',
      userId: 'user-1',
      channelId: 'chan-1',
    });

    expect(res.success).toBe(false);
    expect(res.error).toBe('LLM Rate Limit exceeded');
    expect(res.result).toContain('LLM Rate Limit exceeded');
  });
});
