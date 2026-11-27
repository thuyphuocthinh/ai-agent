import { Test, TestingModule } from '@nestjs/testing';
import { Job } from 'bullmq';
import {
  EJobName,
  IProcessAiTriggerJobData,
  IProcessApprovalJobData,
} from '@agent/core/infrastructure/queue';
import { AiOrchestrationProcessor } from './ai-orchestration.processor';
import { MessageClientService } from '../../streaming/message-client.service';
import { AgentStreamService } from '../../streaming/agent-stream.service';
import {
  ETurnLogEntryKind,
  ETurnLogStatus,
  ITurnEventLog,
  MESSAGE_SINK,
  STREAM_SINK,
  TURN_EVENT_LOG,
  TurnLogEntry,
} from '../../../contracts';
import { TriggerClaimService } from '../../hitl/trigger-claim.service';
import { AgentCancellationService } from '../../cancellation/agent-cancellation.service';
import { TurnCancelledError } from '../../loop/errors/turn-cancelled.error';
import { TurnResolverService } from '../turn/turn-resolver.service';
import { ApprovalExecutionService } from '../../hitl/approval-execution.service';
import { TurnEventRecorderService } from '../turn/turn-event-recorder.service';
import { ConversationCompactionService } from '../context/conversation-compaction.service';

// ai-orchestration.processor.ts import ReactLoopService (dù đã mock qua DI ở
// dưới) — file thật của nó vẫn import @agent/core/common ở module scope, kéo theo
// "nanoid" (ESM-only) mà jest không transform được. Mock thẳng barrel, cùng
// convention đã dùng ở auth.service.spec.ts.
jest.mock('@agent/core/common', () => ({ extractTextFromMcpResult: jest.fn() }));

// Fix Jest ESM import issue with uuid package
jest.mock('uuid', () => ({ v4: jest.fn(() => 'test-uuid') }));

// Giữ hành vi transparent (gọi thẳng qua fn gốc, không cần LangSmith thật) —
// nhưng cho phép assert TÊN/metadata trace đã truyền vào, để test được đúng
// bug đã fix: PROCESS_APPROVAL phải có root trace riêng (mục 7).
jest.mock('langsmith/traceable', () => ({
  traceable: jest.fn(
    (fn: (...args: unknown[]) => unknown) =>
      (...args: unknown[]) =>
        fn(...args),
  ),
}));
import { traceable } from 'langsmith/traceable';

describe('AiOrchestrationProcessor', () => {
  let processor: AiOrchestrationProcessor;

  const mockMessageClient = {
    createMessage: jest.fn(),
    updateMessage: jest.fn(),
    tryUpdateMessage: jest.fn(),
  };
  const mockAgentStream = { emitStep: jest.fn() };
  const mockTriggerClaim = { claim: jest.fn(), release: jest.fn() };
  // Mặc định: turn chưa từng bị yêu cầu Stop — test nào cần mô phỏng Stop tự
  // override isCancelled/getOwner riêng.
  const mockCancellation = {
    startTurn: jest.fn(),
    getOwner: jest.fn(),
    requestCancel: jest.fn(),
    isCancelled: jest.fn().mockResolvedValue(false),
  };
  const mockTurnResolver = { resolveAnswer: jest.fn() };
  const mockApprovalExecution = { processApprovalJob: jest.fn() };
  const mockEventLog: jest.Mocked<ITurnEventLog> = {
    start: jest.fn(),
    appendStep: jest.fn(),
    appendChunk: jest.fn(),
    finish: jest.fn(),
    startHeartbeat: jest.fn(),
    isAlive: jest.fn(),
    getMeta: jest.fn(),
    findActiveTurnId: jest.fn(),
    snapshot: jest.fn(),
    read: jest.fn(),
  };
  const mockRecorder = { idle: jest.fn() };
  const mockCompactionService = { scheduleCompaction: jest.fn() };

  const stepEntry = (
    id: string,
    step: Record<string, unknown>,
    streamKey?: string,
  ): TurnLogEntry =>
    ({
      id,
      kind: ETurnLogEntryKind.STEP,
      context: { userId: 'user-1', messageId: 'reply-1', streamKey },
      step,
    }) as TurnLogEntry;

  const jobData: IProcessAiTriggerJobData = {
    userId: 'user-1',
    channelId: 'channel-1',
    workspaceId: 'workspace-1',
    messageId: 'trigger-msg-1',
    botUserId: 'bot-1',
    channelType: 'direct',
  };

  beforeEach(async () => {
    mockMessageClient.createMessage.mockResolvedValue({ id: 'reply-1' });
    mockMessageClient.updateMessage.mockResolvedValue(undefined);
    mockMessageClient.tryUpdateMessage.mockResolvedValue(undefined);
    mockAgentStream.emitStep.mockResolvedValue(undefined);
    mockTriggerClaim.claim.mockResolvedValue(true);
    mockTriggerClaim.release.mockResolvedValue(undefined);
    mockCancellation.isCancelled.mockResolvedValue(false);
    mockApprovalExecution.processApprovalJob.mockResolvedValue(undefined);
    mockEventLog.start.mockResolvedValue(undefined);
    mockEventLog.finish.mockResolvedValue(undefined);
    mockEventLog.startHeartbeat.mockReturnValue(jest.fn());
    mockEventLog.snapshot.mockResolvedValue([]);
    mockRecorder.idle.mockResolvedValue(undefined);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AiOrchestrationProcessor,
        { provide: MESSAGE_SINK, useValue: mockMessageClient },
        { provide: MessageClientService, useValue: mockMessageClient },
        { provide: STREAM_SINK, useValue: mockAgentStream },
        { provide: AgentStreamService, useValue: mockAgentStream },
        { provide: TriggerClaimService, useValue: mockTriggerClaim },
        { provide: AgentCancellationService, useValue: mockCancellation },
        { provide: TurnResolverService, useValue: mockTurnResolver },
        { provide: ApprovalExecutionService, useValue: mockApprovalExecution },
        { provide: TURN_EVENT_LOG, useValue: mockEventLog },
        { provide: TurnEventRecorderService, useValue: mockRecorder },
        { provide: ConversationCompactionService, useValue: mockCompactionService },
      ],
    }).compile();

    processor = module.get<AiOrchestrationProcessor>(AiOrchestrationProcessor);
  });

  afterEach(() => jest.clearAllMocks());

  const runJob = (data: IProcessAiTriggerJobData = jobData) =>
    processor.process({ name: EJobName.PROCESS_AI_TRIGGER, data } as Job<
      IProcessAiTriggerJobData,
      void,
      EJobName
    >);

  it('creates a placeholder message before doing anything else', async () => {
    mockTurnResolver.resolveAnswer.mockResolvedValue({ content: 'Chào bạn!' });

    await runJob();

    expect(mockMessageClient.createMessage).toHaveBeenCalledWith({
      channelId: jobData.channelId,
      senderId: jobData.botUserId,
      content: '🤖 Đang xử lý...',
    });
  });

  it('records the turn owner and traces resolveAnswer(), then saves whatever TurnResolverService returns', async () => {
    mockTurnResolver.resolveAnswer.mockResolvedValue({
      content: 'Có 2 bảng.',
      toolCalls: [{ tool: 'get_database_schema', status: 'success' }],
    });

    await runJob();

    expect(mockCancellation.startTurn).toHaveBeenCalledWith(
      'reply-1',
      jobData.userId,
    );
    expect(mockTurnResolver.resolveAnswer).toHaveBeenCalledWith(
      jobData,
      'reply-1',
    );
    expect(mockMessageClient.updateMessage).toHaveBeenCalledWith({
      id: 'reply-1',
      userId: jobData.botUserId,
      channelId: jobData.channelId,
      content: 'Có 2 bảng.',
      toolCalls: [{ tool: 'get_database_schema', status: 'success' }],
      executionTimeMs: expect.any(Number),
    });
    // "done" phải bắn luôn, dù trả lời thành công — FE dựa vào đây để tắt icon "đang chạy tool...".
    expect(mockAgentStream.emitStep).toHaveBeenCalledWith(
      {
        userId: jobData.userId,
        channelId: jobData.channelId,
        messageId: 'reply-1',
        channelType: jobData.channelType,
      },
      { type: 'done' },
    );
  });

  it('updates the reply with the raw error message when TurnResolverService throws', async () => {
    mockTurnResolver.resolveAnswer.mockRejectedValue(
      new Error('LLM provider is down'),
    );

    await runJob();

    expect(mockMessageClient.tryUpdateMessage).toHaveBeenCalledWith({
      id: 'reply-1',
      userId: jobData.botUserId,
      content: '⚠️ Lỗi: LLM provider is down',
    });
    // "done" vẫn phải bắn kể cả khi lỗi — không thì FE treo mãi icon "đang chạy".
    expect(mockAgentStream.emitStep).toHaveBeenCalledWith(expect.anything(), {
      type: 'done',
    });
  });

  it('Giai đoạn 4, Step 1 — claims triggerMessageId BEFORE creating the placeholder message', async () => {
    mockTurnResolver.resolveAnswer.mockResolvedValue({ content: 'Chào bạn!' });

    await runJob();

    expect(mockTriggerClaim.claim).toHaveBeenCalledWith(jobData.messageId);
  });

  it('Giai đoạn 4, Step 1 — skips creating a duplicate placeholder when the trigger was already claimed (job retried/redelivered)', async () => {
    mockTriggerClaim.claim.mockResolvedValue(false);

    await runJob();

    expect(mockMessageClient.createMessage).not.toHaveBeenCalled();
    expect(mockTurnResolver.resolveAnswer).not.toHaveBeenCalled();
  });

  it('throws for an unsupported job name', async () => {
    await expect(
      processor.process({
        name: 'unknown_job',
        data: jobData,
      } as unknown as Job<IProcessAiTriggerJobData, void, EJobName>),
    ).rejects.toThrow('Job name unknown_job is not supported');
  });

  it('dispatches PROCESS_APPROVAL jobs to ApprovalExecutionService.processApprovalJob()', async () => {
    const approvalJobData: IProcessApprovalJobData = {
      checkpointId: 'checkpoint-1',
      userId: 'user-1',
    };

    await processor.process({
      name: EJobName.PROCESS_APPROVAL,
      data: approvalJobData,
    } as Job<IProcessApprovalJobData, void, EJobName>);

    expect(mockApprovalExecution.processApprovalJob).toHaveBeenCalledWith(
      approvalJobData,
    );
  });

  it('mục 7 — wraps PROCESS_APPROVAL in its own root trace (AsyncLocalStorage), so 1 approval-resume episode nests as ONE trace instead of every sendMessage/generateStructured/callTool inside it becoming a separate untethered root trace', async () => {
    const approvalJobData: IProcessApprovalJobData = {
      checkpointId: 'checkpoint-1',
      userId: 'user-1',
    };

    await processor.process({
      name: EJobName.PROCESS_APPROVAL,
      data: approvalJobData,
    } as Job<IProcessApprovalJobData, void, EJobName>);

    expect(traceable).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({
        name: 'ai-orchestration-approval',
        metadata: { checkpointId: 'checkpoint-1', userId: 'user-1' },
      }),
    );
  });

  describe('cancelTurn (Stop request)', () => {
    it('throws TURN_NOT_FOUND when no turn is running for this messageId (finished long ago / never started)', async () => {
      mockCancellation.getOwner.mockResolvedValue(null);

      await expect(
        processor.cancelTurn({ userId: 'user-1', messageId: 'reply-1' }),
      ).rejects.toThrow();
      expect(mockCancellation.requestCancel).not.toHaveBeenCalled();
    });

    it('throws TURN_FORBIDDEN when the requester is not the user who triggered the turn', async () => {
      mockCancellation.getOwner.mockResolvedValue('user-1');

      await expect(
        processor.cancelTurn({
          userId: 'some-other-user',
          messageId: 'reply-1',
        }),
      ).rejects.toThrow();
      expect(mockCancellation.requestCancel).not.toHaveBeenCalled();
    });

    it('requests cancellation when the requester owns the turn', async () => {
      mockCancellation.getOwner.mockResolvedValue('user-1');

      await processor.cancelTurn({ userId: 'user-1', messageId: 'reply-1' });

      expect(mockCancellation.requestCancel).toHaveBeenCalledWith('reply-1');
    });
  });

  describe('handleAiTrigger — Stop mid-turn (TurnCancelledError)', () => {
    it('shows "Đã dừng theo yêu cầu" instead of an error, and still emits done, when the turn is cancelled with no partial text', async () => {
      mockTurnResolver.resolveAnswer.mockRejectedValue(
        new TurnCancelledError(),
      );

      await runJob();

      expect(mockMessageClient.tryUpdateMessage).toHaveBeenCalledWith({
        id: 'reply-1',
        userId: jobData.botUserId,
        content: '⏹️ Đã dừng theo yêu cầu.',
      });
      expect(mockAgentStream.emitStep).toHaveBeenCalledWith(
        {
          userId: jobData.userId,
          channelId: jobData.channelId,
          messageId: 'reply-1',
          channelType: jobData.channelType,
        },
        { type: 'done' },
      );
    });

    it('keeps the partial text already streamed instead of wiping it, when the turn is cancelled mid-stream', async () => {
      mockTurnResolver.resolveAnswer.mockRejectedValue(
        new TurnCancelledError('Đang tìm dữ liệu kh'),
      );

      await runJob();

      expect(mockMessageClient.tryUpdateMessage).toHaveBeenCalledWith({
        id: 'reply-1',
        userId: jobData.botUserId,
        content: 'Đang tìm dữ liệu kh',
      });
    });
  });

  describe('handleAiTrigger — hardening: a turn must never be silently lost', () => {
    it('releases the trigger claim and rethrows when createMessage() fails BEFORE any reply message exists — nothing was created yet, so a retry is safe', async () => {
      mockMessageClient.createMessage.mockRejectedValue(
        new Error('message service unreachable'),
      );

      await expect(runJob()).rejects.toThrow('message service unreachable');

      expect(mockTriggerClaim.release).toHaveBeenCalledWith(jobData.messageId);
      // Chưa có reply.id (createMessage() lỗi ngay từ đầu) — không có gì để
      // update, và không được gọi resolveAnswer().
      expect(mockTurnResolver.resolveAnswer).not.toHaveBeenCalled();
    });

    it('releases the trigger claim and rethrows when cancellation.startTurn() fails right after createMessage() succeeds', async () => {
      mockCancellation.startTurn.mockRejectedValueOnce(
        new Error('redis unreachable'),
      );

      await expect(runJob()).rejects.toThrow('redis unreachable');

      expect(mockTriggerClaim.release).toHaveBeenCalledWith(jobData.messageId);
      expect(mockTurnResolver.resolveAnswer).not.toHaveBeenCalled();
    });

    it('does NOT release the trigger claim for a failure AFTER the reply message already exists — a retry at that point could create a duplicate "Đang xử lý..." message', async () => {
      mockTurnResolver.resolveAnswer.mockRejectedValue(
        new Error('LLM provider is down'),
      );

      await runJob();

      expect(mockTriggerClaim.release).not.toHaveBeenCalled();
    });
  });

  describe('Turn event log (reload/reconnect)', () => {
    it('đánh dấu turn ACTIVE ngay sau khi tạo reply, TRƯỚC khi engine chạy', async () => {
      const order: string[] = [];
      mockEventLog.start.mockImplementation(async () => {
        order.push('start');
      });
      mockTurnResolver.resolveAnswer.mockImplementation(async () => {
        order.push('resolve');
        return { content: 'ok' };
      });

      await runJob();

      expect(mockEventLog.start).toHaveBeenCalledWith({
        messageId: 'reply-1',
        conversationId: jobData.channelId,
        userId: jobData.userId,
      });
      expect(order).toEqual(['start', 'resolve']);
    });

    it('chờ recorder ghi xong rồi mới phát DONE, và chốt log SAU DONE', async () => {
      const order: string[] = [];
      mockTurnResolver.resolveAnswer.mockResolvedValue({ content: 'ok' });
      mockRecorder.idle.mockImplementation(async () => {
        order.push('recorder-idle');
      });
      mockAgentStream.emitStep.mockImplementation(async (_ctx, step) => {
        order.push(`emit-${step.type}`);
      });
      mockEventLog.finish.mockImplementation(async (_id, status) => {
        order.push(`finish-${status}`);
      });

      await runJob();

      expect(order).toEqual(['recorder-idle', 'emit-done', 'finish-done']);
    });

    it('phát nhịp tim suốt turn và dừng nhịp tim khi turn kết thúc (kể cả lỗi)', async () => {
      const stop = jest.fn();
      mockEventLog.startHeartbeat.mockReturnValue(stop);
      mockTurnResolver.resolveAnswer.mockRejectedValue(new Error('LLM down'));

      await runJob();

      expect(mockEventLog.startHeartbeat).toHaveBeenCalledWith('reply-1');
      expect(stop).toHaveBeenCalledTimes(1);
    });

    it('chốt trạng thái CANCELLED / FAILED tương ứng', async () => {
      mockTurnResolver.resolveAnswer.mockRejectedValueOnce(new TurnCancelledError('x'));
      await runJob();
      expect(mockEventLog.finish).toHaveBeenLastCalledWith('reply-1', ETurnLogStatus.CANCELLED);

      mockTurnResolver.resolveAnswer.mockRejectedValueOnce(new Error('LLM down'));
      await runJob();
      expect(mockEventLog.finish).toHaveBeenLastCalledWith('reply-1', ETurnLogStatus.FAILED);
    });

    it('thành công: engine trả đủ steps/toolCalls thì không cần đọc log', async () => {
      mockTurnResolver.resolveAnswer.mockResolvedValue({
        content: 'Câu trả lời cuối cùng',
        steps: [{ agent: 'a', task: 't', toolCalls: [] }],
        toolCalls: [{ tool: 'x.y', status: 'success' }],
      });

      await runJob();

      expect(mockEventLog.snapshot).not.toHaveBeenCalled();
      expect(mockMessageClient.updateMessage).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'reply-1', content: 'Câu trả lời cuối cùng' }),
      );
    });

    it('thành công nhưng engine không trả steps/toolCalls: lấy từ log, bỏ qua mảng rỗng', async () => {
      mockTurnResolver.resolveAnswer.mockResolvedValue({ content: 'xong' });
      mockEventLog.snapshot.mockResolvedValue([
        stepEntry('1-0', { type: 'tool_call', tool: 'sql.run', toolCallId: 'tc-1', argsPreview: 'q' }),
        stepEntry('2-0', { type: 'tool_result', tool: 'sql.run', toolCallId: 'tc-1', resultPreview: 'r' }),
      ]);

      await runJob();

      const payload = mockMessageClient.updateMessage.mock.calls[0][0];
      expect(payload.toolCalls).toEqual([
        expect.objectContaining({ toolCallId: 'tc-1', argsPreview: 'q', resultPreview: 'r' }),
      ]);
      expect(payload.steps).toBeUndefined();
    });

    it('lưu quyết định định tuyến (routing) cùng câu trả lời để dựng lại card Supervisor sau reload', async () => {
      mockTurnResolver.resolveAnswer.mockResolvedValue({
        content: 'xong',
        routing: { mode: 'single_agent' },
      });

      await runJob();

      expect(mockMessageClient.updateMessage).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'reply-1', routing: { mode: 'single_agent' } }),
      );
    });

    it('huỷ giữa chừng: lưu phần text/steps đã sinh ra từ log', async () => {
      mockTurnResolver.resolveAnswer.mockRejectedValue(new TurnCancelledError(undefined));
      mockEventLog.snapshot.mockResolvedValue([
        stepEntry('1-0', { type: 'step_start', label: 'Bước 1' }),
        stepEntry('2-0', { type: 'token', text: 'Dữ liệu ' }),
        stepEntry('3-0', { type: 'token', text: 'dở dang' }),
        stepEntry('4-0', { type: 'token', text: 'của agent phụ' }, 'agent-2'),
      ]);

      await runJob();

      expect(mockMessageClient.tryUpdateMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'reply-1',
          content: 'Dữ liệu dở dang',
          steps: [expect.objectContaining({ task: 'Bước 1' })],
        }),
      );
    });

    it('lỗi: nối thông báo lỗi sau phần text đã stream', async () => {
      mockTurnResolver.resolveAnswer.mockRejectedValue(new Error('LLM down'));
      mockEventLog.snapshot.mockResolvedValue([
        stepEntry('1-0', { type: 'token', text: 'Phần đầu' }),
      ]);

      await runJob();

      const payload = mockMessageClient.tryUpdateMessage.mock.calls[0][0];
      expect(payload.content).toContain('Phần đầu');
      expect(payload.content).toContain('Đã dừng do sự cố');
    });

    it('không đọc được log vẫn lưu DB bình thường (không làm hỏng turn)', async () => {
      mockTurnResolver.resolveAnswer.mockResolvedValue({ content: 'xong' });
      mockEventLog.snapshot.mockRejectedValue(new Error('redis down'));

      await runJob();

      expect(mockMessageClient.updateMessage).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'reply-1', content: 'xong' }),
      );
    });
  });

  describe('Background compaction scheduling (AC-11)', () => {
    it('schedules compaction for channelId after DONE turn completes', async () => {
      mockTurnResolver.resolveAnswer.mockResolvedValue({ content: 'xong' });

      await runJob();

      expect(mockCompactionService.scheduleCompaction).toHaveBeenCalledTimes(1);
      expect(mockCompactionService.scheduleCompaction).toHaveBeenCalledWith(
        jobData.channelId,
      );
    });

    it('does not schedule compaction when the turn fails or is cancelled', async () => {
      mockTurnResolver.resolveAnswer.mockRejectedValueOnce(new Error('LLM down'));
      await runJob();
      expect(mockCompactionService.scheduleCompaction).not.toHaveBeenCalled();

      mockTurnResolver.resolveAnswer.mockRejectedValueOnce(
        new TurnCancelledError('partial'),
      );
      await runJob();
      expect(mockCompactionService.scheduleCompaction).not.toHaveBeenCalled();
    });
  });
});
