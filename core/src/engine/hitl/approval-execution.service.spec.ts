import { Test, TestingModule } from '@nestjs/testing';
import { IProcessApprovalJobData } from '@agent/core/infrastructure/queue';
import { ECheckpointKind } from '@agent/core/constants';
import { ApprovalExecutionService } from './approval-execution.service';
import { MessageClientService } from '../streaming/message-client.service';
import { SupervisorService } from '../supervisor/supervisor.service';
import { AgentStreamService } from '../streaming/agent-stream.service';
import { CheckpointService } from './checkpoint.service';
import {
  TOOL_PROVIDER,
  EXECUTION_ENGINE_REGISTRY,
  ETurnLogStatus,
  TURN_EVENT_LOG,
} from '../../contracts';
import { TurnEventRecorderService } from '../orchestrator/turn/turn-event-recorder.service';
import { AgentCancellationService } from '../cancellation/agent-cancellation.service';
import { TurnCancelledError } from '../loop/errors/turn-cancelled.error';
import { TurnResolverService } from '../orchestrator/turn/turn-resolver.service';
import { MemoryManagerService } from '../../memory/memory-manager.service';
import { ApprovalContinuationPlannerService } from './approval-continuation-planner.service';
import { resolveDataCharBudget } from '../../common/text/token-budget.util';
import { AutonomousEngine } from '../orchestrator/engines/autonomous.engine';

// approval-execution.service.ts import @agent/core/common ở module scope (extractTextFromMcpResult)
// — mock thẳng barrel để tránh kéo theo "nanoid" (ESM-only) mà jest không transform được.
jest.mock('@agent/core/common', () => ({ extractTextFromMcpResult: jest.fn() }));
import { extractTextFromMcpResult } from '@agent/core/common';

describe('ApprovalExecutionService', () => {
  let service: ApprovalExecutionService;

  const mockMessageClient = {
    updateMessage: jest.fn(),
    tryUpdateMessage: jest.fn(),
  };
  const mockSupervisor = { getAvailableAgents: jest.fn() };
  const mockAgentStream = { emitStep: jest.fn() };
  const mockCheckpoint = {
    findById: jest.fn(),
    claimExecution: jest.fn(),
    markToolExecuted: jest.fn(),
  };
  const mockMcpClient = { callTool: jest.fn() };
  const mockCancellation = {
    startTurn: jest.fn(),
    isCancelled: jest.fn().mockResolvedValue(false),
  };
  const mockTurnResolver = { continueRounds: jest.fn() };
  const mockMemoryManager = {
    buildBudget: jest.fn((modelId: string) => ({
      toolResultCharBudget: resolveDataCharBudget(modelId),
      memoryCharBudget: 0,
      historyCharBudget: 0,
    })),
  };
  const mockContinuationPlanner = { resolveRemainingSteps: jest.fn() };
  const mockEventLog = {
    start: jest.fn(),
    finish: jest.fn(),
    startHeartbeat: jest.fn(),
  };
  const mockTurnRecorder = { idle: jest.fn() };

  beforeEach(async () => {
    mockMessageClient.updateMessage.mockResolvedValue(undefined);
    mockMessageClient.tryUpdateMessage.mockResolvedValue(undefined);
    mockAgentStream.emitStep.mockResolvedValue(undefined);
    mockCheckpoint.claimExecution.mockResolvedValue({ claimed: true });
    mockCheckpoint.markToolExecuted.mockResolvedValue(undefined);
    mockSupervisor.getAvailableAgents.mockResolvedValue([]);
    mockTurnResolver.continueRounds.mockResolvedValue({
      content: 'ok',
      toolCalls: undefined,
    });
    mockEventLog.start.mockResolvedValue(undefined);
    mockEventLog.finish.mockResolvedValue(undefined);
    mockEventLog.startHeartbeat.mockReturnValue(jest.fn());
    mockTurnRecorder.idle.mockResolvedValue(undefined);
    // Mặc định passthrough — không thiếu số lượng gì (đã có test riêng cho
    // logic quantity-check trong approval-continuation-planner.service.spec.ts).
    mockContinuationPlanner.resolveRemainingSteps.mockImplementation(
      (checkpoint, resultText) =>
        Promise.resolve({ remainingSteps: checkpoint.remainingSteps, resultText }),
    );

    const autonomousEngine = new AutonomousEngine(
      {} as any, // reactLoop
      mockCancellation as any, // cancellation
      {} as any, // checkpointPause
      {} as any, // metrics
      {} as any, // subAgentSpawner
      mockSupervisor as any, // supervisor
      mockAgentStream as any, // streamSink
      mockMemoryManager as any, // memoryManager
      mockMcpClient as any, // toolProvider
      mockCheckpoint as any, // checkpointService
    );
    jest
      .spyOn(autonomousEngine, 'continueSupervisorRounds')
      .mockImplementation((...args: any[]) =>
        (mockTurnResolver.continueRounds as any)(...args),
      );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ApprovalExecutionService,
        { provide: MessageClientService, useValue: mockMessageClient },
        { provide: SupervisorService, useValue: mockSupervisor },
        { provide: AgentStreamService, useValue: mockAgentStream },
        { provide: CheckpointService, useValue: mockCheckpoint },
        { provide: TOOL_PROVIDER, useValue: mockMcpClient },
        { provide: AgentCancellationService, useValue: mockCancellation },
        { provide: TurnResolverService, useValue: mockTurnResolver },
        { provide: MemoryManagerService, useValue: mockMemoryManager },
        {
          provide: ApprovalContinuationPlannerService,
          useValue: mockContinuationPlanner,
        },
        { provide: TURN_EVENT_LOG, useValue: mockEventLog },
        { provide: TurnEventRecorderService, useValue: mockTurnRecorder },
        {
          provide: EXECUTION_ENGINE_REGISTRY,
          useValue: {
            get: jest.fn().mockImplementation((mode: string) => {
              if (
                mode === 'dynamic_supervisor' ||
                mode === 'autonomous' ||
                mode === 'single_agent'
              ) {
                return autonomousEngine;
              }
              return undefined;
            }),
          },
        },
      ],
    }).compile();

    service = module.get<ApprovalExecutionService>(ApprovalExecutionService);
  });

  afterEach(() => jest.clearAllMocks());

  describe('processApprovalJob (Giai đoạn 3 — HITL, Step 5 — thực thi nền qua queue)', () => {
    const checkpoint = {
      id: 'checkpoint-1',
      replyMessageId: 'approval-msg-1',
      userId: 'user-1',
      botUserId: 'bot-1',
      channelId: 'channel-1',
      workspaceId: 'workspace-1',
      channelType: 'direct',
      originalPrompt: 'cập nhật status đơn OrderId=1 thành Completed',
      pendingTool: {
        provider: 'sql_server',
        name: 'execute_write_query',
        args: { query: "UPDATE Orders SET Status='Completed' WHERE OrderId=1" },
      },
      pendingTask: 'cập nhật status đơn OrderId=1',
      roundsSoFar: [
        {
          agent: 'sql_server',
          task: 'tìm đơn OrderId=1',
          result: 'Đơn OrderId=1 đang Pending',
        },
      ],
      history: [],
      kind: ECheckpointKind.APPROVAL,
    };

    const runApprovalJob = (
      data: IProcessApprovalJobData = {
        checkpointId: 'checkpoint-1',
        userId: 'user-1',
      },
    ) => service.processApprovalJob(data);

    it('runs the real tool, then re-enters the Supervisor loop with the result folded into rounds — NOT resumed on the same agent', async () => {
      mockCheckpoint.findById.mockResolvedValue(checkpoint);
      mockMcpClient.callTool.mockResolvedValue({
        content: [{ type: 'text', text: 'raw mcp result' }],
      });
      (extractTextFromMcpResult as jest.Mock).mockReturnValue(
        '1 dòng đã được cập nhật.',
      );
      const agents = [
        { provider: 'sql_server', label: 'SQL Server', description: 'desc' },
      ];
      mockSupervisor.getAvailableAgents.mockResolvedValue(agents);
      mockTurnResolver.continueRounds.mockResolvedValue({
        content: 'Đã cập nhật đơn OrderId=1 thành Completed.',
        toolCalls: [
          { tool: 'sql_server.execute_write_query', status: 'success' },
        ],
      });

      await runApprovalJob();

      expect(mockCheckpoint.findById).toHaveBeenCalledWith({
        id: 'checkpoint-1',
      });
      expect(mockMcpClient.callTool).toHaveBeenCalledWith({
        provider: 'sql_server',
        name: 'execute_write_query',
        args: { query: "UPDATE Orders SET Status='Completed' WHERE OrderId=1" },
        ownerId: 'user-1',
        workspaceId: 'workspace-1',
        messageId: 'approval-msg-1',
      });
      // Quay lại vòng lặp Supervisor với rounds đã gồm kết quả hành động vừa
      // duyệt — KHÔNG resume thẳng ReactLoop trên agent vừa dùng (bug cũ).
      expect(mockTurnResolver.continueRounds).toHaveBeenCalledWith(
        {
          userId: 'user-1',
          channelId: 'channel-1',
          workspaceId: 'workspace-1',
          messageId: 'approval-msg-1',
          botUserId: 'bot-1',
          channelType: 'direct',
        },
        'approval-msg-1',
        checkpoint.originalPrompt,
        agents,
        checkpoint.history,
        [
          ...checkpoint.roundsSoFar,
          {
            agent: 'sql_server',
            task: 'cập nhật status đơn OrderId=1',
            result: '1 dòng đã được cập nhật.',
          },
        ],
        [],
        undefined,
        undefined,
      );
      expect(mockMessageClient.updateMessage).toHaveBeenCalledWith({
        id: 'approval-msg-1',
        userId: 'bot-1',
        channelId: 'channel-1',
        content: 'Đã cập nhật đơn OrderId=1 thành Completed.',
        toolCalls: [
          { tool: 'sql_server.execute_write_query', status: 'success' },
        ],
      });
      expect(mockAgentStream.emitStep).toHaveBeenCalledWith(expect.anything(), {
        type: 'done',
      });
      expect(mockCheckpoint.markToolExecuted).toHaveBeenCalledWith({
        id: 'checkpoint-1',
      });
    });

    it('caps an oversized tool result before folding it into the rounds passed to the Supervisor loop', async () => {
      mockCheckpoint.findById.mockResolvedValue(checkpoint);
      mockMcpClient.callTool.mockResolvedValue({
        content: [{ type: 'text', text: 'raw mcp result' }],
      });
      // accuracy_problem.md mục 5 — budget giờ tính THEO model thật
      // (gpt-4o-mini ~153.600 ký tự), không còn hằng số cứng 6000 — dữ liệu
      // phải vượt XA budget mới để còn kiểm được hành vi cap.
      const hugeResult = 'x'.repeat(160_000);
      (extractTextFromMcpResult as jest.Mock).mockReturnValue(hugeResult);

      await runApprovalJob();

      const roundsArg = mockTurnResolver.continueRounds.mock.calls[0][5];
      const foldedResult = roundsArg[roundsArg.length - 1].result;
      expect(foldedResult.length).toBeLessThan(hugeResult.length);
      expect(foldedResult).toContain('[truncated');
    });

    it('accuracy_problem.md mục 5 — KHÔNG cắt kết quả tool cỡ thật (VD 500 dòng SQL, ~40k ký tự) sau khi đã được duyệt', async () => {
      mockCheckpoint.findById.mockResolvedValue(checkpoint);
      mockMcpClient.callTool.mockResolvedValue({
        content: [{ type: 'text', text: 'raw mcp result' }],
      });
      const fiveHundredRows = JSON.stringify(
        Array.from({ length: 500 }, (_, i) => ({
          id: i,
          name: `Khách hàng ${i}`,
          email: `customer${i}@example.com`,
        })),
      );
      (extractTextFromMcpResult as jest.Mock).mockReturnValue(fiveHundredRows);

      await runApprovalJob();

      const roundsArg = mockTurnResolver.continueRounds.mock.calls[0][5];
      const foldedResult = roundsArg[roundsArg.length - 1].result;
      expect(foldedResult).toContain('"id":0');
      expect(foldedResult).toContain('"id":499');
      expect(foldedResult).not.toContain('truncated');
    });

    it('forwards whatever the Supervisor loop returns as-is (VD toolCalls: undefined) to the final message update', async () => {
      mockCheckpoint.findById.mockResolvedValue(checkpoint);
      mockMcpClient.callTool.mockResolvedValue({
        content: [{ type: 'text', text: 'raw mcp result' }],
      });
      (extractTextFromMcpResult as jest.Mock).mockReturnValue(
        '1 dòng đã được cập nhật.',
      );
      mockTurnResolver.continueRounds.mockResolvedValue({
        content: 'Đã cập nhật đơn OrderId=1 thành Completed.',
        toolCalls: undefined,
      });

      await runApprovalJob();

      expect(mockMessageClient.updateMessage).toHaveBeenCalledWith({
        id: 'approval-msg-1',
        userId: 'bot-1',
        channelId: 'channel-1',
        content: 'Đã cập nhật đơn OrderId=1 thành Completed.',
        toolCalls: undefined,
      });
    });

    it('falls back to the raw error message if running the real tool fails, but still emits done', async () => {
      mockCheckpoint.findById.mockResolvedValue(checkpoint);
      mockMcpClient.callTool.mockRejectedValue(
        new Error('connect ECONNREFUSED'),
      );

      await runApprovalJob();

      expect(mockTurnResolver.continueRounds).not.toHaveBeenCalled();
      expect(mockMessageClient.tryUpdateMessage).toHaveBeenCalledWith({
        id: 'approval-msg-1',
        userId: 'bot-1',
        content: '⚠️ Lỗi: connect ECONNREFUSED',
      });
      expect(mockAgentStream.emitStep).toHaveBeenCalledWith(expect.anything(), {
        type: 'done',
      });
    });

    it('mục 6 — stops immediately and shows the tool error, WITHOUT re-entering the Supervisor loop, when the approved tool call itself resolves with isError (not a connect failure — that already throws and is handled separately)', async () => {
      mockCheckpoint.findById.mockResolvedValue(checkpoint);
      mockMcpClient.callTool.mockResolvedValue({
        content: [
          {
            type: 'text',
            text: 'Error [TOOL_EXECUTION_ERROR:append_document_text]: insufficient permission',
          },
        ],
        isError: true,
      });
      (extractTextFromMcpResult as jest.Mock).mockReturnValue(
        'Error [TOOL_EXECUTION_ERROR:append_document_text]: insufficient permission',
      );

      await runApprovalJob();

      // KHÔNG quay lại Supervisor — đây chính là bug thật đã gặp: Supervisor cứ
      // re-plan/thử lại đúng hành động này, destructiveHint lại yêu cầu duyệt,
      // lặp duyệt/lỗi nhiều lần.
      expect(mockTurnResolver.continueRounds).not.toHaveBeenCalled();
      expect(mockMessageClient.updateMessage).toHaveBeenCalledWith({
        id: 'approval-msg-1',
        userId: 'bot-1',
        channelId: 'channel-1',
        content:
          '⚠️ Hành động "execute_write_query" đã được duyệt nhưng thực thi thất bại:\nError [TOOL_EXECUTION_ERROR:append_document_text]: insufficient permission',
      });
      expect(mockAgentStream.emitStep).toHaveBeenCalledWith(expect.anything(), {
        type: 'done',
      });
      // Bug fix — tool ĐÃ chạy xong thật (chỉ trả lỗi), không set toolExecutedAt
      // khiến findStalledExecution() hiểu nhầm thành worker crash 30 phút sau,
      // ghi đè thông báo lỗi (đã đúng) này bằng cảnh báo sai.
      expect(mockCheckpoint.markToolExecuted).toHaveBeenCalledWith({
        id: 'checkpoint-1',
      });
    });

    it("reports the error via tryUpdateMessage() (not the throwing updateMessage()) — resilience to a double-failure is MessageClientService.tryUpdateMessage()'s own responsibility, see message-client.service.spec.ts", async () => {
      mockCheckpoint.findById.mockResolvedValue(checkpoint);
      mockMcpClient.callTool.mockRejectedValue(
        new Error('connect ECONNREFUSED'),
      );

      await expect(runApprovalJob()).resolves.toBeUndefined();

      expect(mockMessageClient.tryUpdateMessage).toHaveBeenCalledWith({
        id: 'approval-msg-1',
        userId: 'bot-1',
        content: '⚠️ Lỗi: connect ECONNREFUSED',
      });
      expect(mockAgentStream.emitStep).toHaveBeenCalledWith(expect.anything(), {
        type: 'done',
      });
    });

    it('logs and returns quietly (does not throw) when the checkpoint can no longer be found', async () => {
      mockCheckpoint.findById.mockResolvedValue(null);

      await expect(runApprovalJob()).resolves.toBeUndefined();

      expect(mockMcpClient.callTool).not.toHaveBeenCalled();
      expect(mockMessageClient.updateMessage).not.toHaveBeenCalled();
    });

    it('Giai đoạn 4, Step 1 — claims execution BEFORE running the real tool, using the checkpoint id', async () => {
      mockCheckpoint.findById.mockResolvedValue(checkpoint);
      mockMcpClient.callTool.mockResolvedValue({
        content: [{ type: 'text', text: 'raw mcp result' }],
      });

      await runApprovalJob();

      expect(mockCheckpoint.claimExecution).toHaveBeenCalledWith({
        id: 'checkpoint-1',
      });
    });

    it('does NOT run the tool a second time when execution was already claimed (stalled/redelivered job)', async () => {
      mockCheckpoint.findById.mockResolvedValue(checkpoint);
      mockCheckpoint.claimExecution.mockResolvedValue({ claimed: false });

      await runApprovalJob();

      expect(mockMcpClient.callTool).not.toHaveBeenCalled();
      expect(mockTurnResolver.continueRounds).not.toHaveBeenCalled();
      expect(mockMessageClient.updateMessage).not.toHaveBeenCalled();
    });

    it('refreshes turn ownership before resuming, so Stop still works even if the original 15-min TTL already expired while the checkpoint sat pending', async () => {
      mockCheckpoint.findById.mockResolvedValue(checkpoint);
      mockMcpClient.callTool.mockResolvedValue({
        content: [{ type: 'text', text: 'raw mcp result' }],
      });

      await runApprovalJob();

      expect(mockCancellation.startTurn).toHaveBeenCalledWith(
        checkpoint.replyMessageId,
        'user-1',
      );
    });

    it('shows "Đã dừng theo yêu cầu" instead of a generic error when the Supervisor loop is cancelled mid-flight', async () => {
      mockCheckpoint.findById.mockResolvedValue(checkpoint);
      mockMcpClient.callTool.mockResolvedValue({
        content: [{ type: 'text', text: 'raw mcp result' }],
      });
      mockTurnResolver.continueRounds.mockRejectedValue(
        new TurnCancelledError(),
      );

      await runApprovalJob();

      expect(mockMessageClient.tryUpdateMessage).toHaveBeenCalledWith({
        id: checkpoint.replyMessageId,
        userId: checkpoint.botUserId,
        content: '⏹️ Đã dừng theo yêu cầu.',
      });
      expect(mockAgentStream.emitStep).toHaveBeenCalledWith(
        expect.objectContaining({ messageId: checkpoint.replyMessageId }),
        { type: 'done' },
      );
    });

    it('forwards a repeated approval-pause answer from the Supervisor loop the same as any other answer — no special-casing needed anymore', async () => {
      mockCheckpoint.findById.mockResolvedValue(checkpoint);
      mockMcpClient.callTool.mockResolvedValue({
        content: [{ type: 'text', text: 'Đơn OrderId=1 đã Completed.' }],
      });
      (extractTextFromMcpResult as jest.Mock).mockReturnValue(
        'Đơn OrderId=1 đã Completed.',
      );
      // TurnResolverService tự pause lần 2 (qua CheckpointPauseService) NẾU vòng
      // tiếp theo lại gặp 1 tool rủi ro khác — ApprovalExecutionService không cần
      // biết chuyện đó xảy ra, chỉ forward đúng AnswerResult nhận được.
      mockTurnResolver.continueRounds.mockResolvedValue({
        content:
          '⏸️ Cần bạn duyệt 1 hành động trước khi tiếp tục — xem tin nhắn bên dưới.',
        toolCalls: undefined,
      });

      await runApprovalJob();

      expect(mockMessageClient.updateMessage).toHaveBeenCalledWith({
        id: checkpoint.replyMessageId,
        userId: checkpoint.botUserId,
        channelId: checkpoint.channelId,
        content:
          '⏸️ Cần bạn duyệt 1 hành động trước khi tiếp tục — xem tin nhắn bên dưới.',
        toolCalls: undefined,
      });
    });
  });

  describe('processApprovalJob — resolveClarificationCheckpoint (accuracy_problem.md mục 1)', () => {
    const clarificationCheckpoint = {
      id: 'checkpoint-2',
      replyMessageId: 'clarification-msg-1',
      userId: 'user-1',
      botUserId: 'bot-1',
      channelId: 'channel-1',
      workspaceId: 'workspace-1',
      channelType: 'direct',
      originalPrompt: 'lưu thông tin này lại giúp tôi',
      pendingTool: null,
      pendingTask: 'lưu thông tin này lại',
      roundsSoFar: [],
      history: [],
      kind: ECheckpointKind.CLARIFICATION,
      clarificationQuestion: 'Bạn muốn dùng "Google Docs" hay "Notion"?',
      clarificationCandidates: [
        { provider: 'google_docs', label: 'Google Docs' },
        { provider: 'notion', label: 'Notion' },
      ],
      selectedProvider: 'notion',
    };

    const runApprovalJob = (
      data: IProcessApprovalJobData = {
        checkpointId: 'checkpoint-2',
        userId: 'user-1',
      },
    ) => service.processApprovalJob(data);

    it('forces the selected agent into the pending step and resumes continueRounds() — does NOT call any tool directly', async () => {
      mockCheckpoint.findById.mockResolvedValue(clarificationCheckpoint);
      const agents = [
        { provider: 'notion', label: 'Notion', description: 'desc' },
      ];
      mockSupervisor.getAvailableAgents.mockResolvedValue(agents);
      mockTurnResolver.continueRounds.mockResolvedValue({
        content: 'Đã lưu vào Notion.',
        toolCalls: [],
      });

      await runApprovalJob();

      expect(mockMcpClient.callTool).not.toHaveBeenCalled();
      expect(mockTurnResolver.continueRounds).toHaveBeenCalledWith(
        {
          userId: 'user-1',
          channelId: 'channel-1',
          workspaceId: 'workspace-1',
          messageId: 'clarification-msg-1',
          botUserId: 'bot-1',
          channelType: 'direct',
        },
        'clarification-msg-1',
        'lưu thông tin này lại giúp tôi',
        agents,
        [],
        [],
        [],
        { agent: 'notion', task: 'lưu thông tin này lại' },
        undefined,
      );
      expect(mockMessageClient.updateMessage).toHaveBeenCalledWith({
        id: 'clarification-msg-1',
        userId: 'bot-1',
        channelId: 'channel-1',
        content: 'Đã lưu vào Notion.',
        toolCalls: [],
      });
    });

    it('accuracy_problem.md mục 9.2 — forwards the checkpoint remainingSteps (B, C after the ambiguous step) into continueRounds() so they are not lost', async () => {
      const remainingSteps = [
        { agent: 'sql_server', task: 'ghi log vào bảng logs' },
      ];
      mockCheckpoint.findById.mockResolvedValue({
        ...clarificationCheckpoint,
        remainingSteps,
      });
      const agents = [
        { provider: 'notion', label: 'Notion', description: 'desc' },
        { provider: 'sql_server', label: 'SQL Server', description: 'desc' },
      ];
      mockSupervisor.getAvailableAgents.mockResolvedValue(agents);
      mockTurnResolver.continueRounds.mockResolvedValue({
        content: 'Đã lưu vào Notion và ghi log.',
        toolCalls: [],
      });

      await runApprovalJob();

      expect(mockTurnResolver.continueRounds).toHaveBeenCalledWith(
        expect.anything(),
        'clarification-msg-1',
        'lưu thông tin này lại giúp tôi',
        agents,
        [],
        [],
        [],
        { agent: 'notion', task: 'lưu thông tin này lại' },
        remainingSteps,
      );
    });

    it('keeps the "done" signal + Stop/cancel handling identical to approveCheckpoint()', async () => {
      mockCheckpoint.findById.mockResolvedValue(clarificationCheckpoint);
      mockSupervisor.getAvailableAgents.mockResolvedValue([]);
      mockTurnResolver.continueRounds.mockRejectedValue(
        new TurnCancelledError('phần đã có'),
      );

      await runApprovalJob();

      expect(mockMessageClient.tryUpdateMessage).toHaveBeenCalledWith({
        id: 'clarification-msg-1',
        userId: 'bot-1',
        content: 'phần đã có',
      });
      expect(mockAgentStream.emitStep).toHaveBeenCalledWith(
        {
          userId: 'user-1',
          channelId: 'channel-1',
          messageId: 'clarification-msg-1',
          channelType: 'direct',
        },
        { type: 'done' },
      );
    });
  });

  describe('turn event log của turn tiếp tục sau duyệt/làm rõ (reload giữa chừng vẫn reconnect được)', () => {
    const checkpoint = {
      id: 'checkpoint-log',
      replyMessageId: 'approval-msg-log',
      userId: 'user-1',
      botUserId: 'bot-1',
      channelId: 'channel-1',
      workspaceId: 'workspace-1',
      channelType: 'direct',
      originalPrompt: 'cập nhật đơn',
      pendingTool: { provider: 'sql_server', name: 'execute_write_query', args: {} },
      pendingTask: 'cập nhật đơn',
      roundsSoFar: [],
      history: [],
      kind: ECheckpointKind.APPROVAL,
    };

    beforeEach(() => {
      mockCheckpoint.findById.mockResolvedValue(checkpoint);
      mockMcpClient.callTool.mockResolvedValue({ content: [{ type: 'text', text: 'x' }] });
      (extractTextFromMcpResult as jest.Mock).mockReturnValue('ok');
    });

    const run = () =>
      service.processApprovalJob({ checkpointId: 'checkpoint-log', userId: 'user-1' });

    it('ACTIVE trước khi chạy tiếp, phát nhịp tim, rồi chốt DONE SAU event done', async () => {
      const order: string[] = [];
      const stop = jest.fn(() => order.push('stop-heartbeat'));
      mockEventLog.start.mockImplementation(async (dto) => {
        order.push('start');
        expect(dto).toEqual({
          messageId: 'approval-msg-log',
          conversationId: 'channel-1',
          userId: 'user-1',
        });
      });
      mockEventLog.startHeartbeat.mockReturnValue(stop);
      mockTurnResolver.continueRounds.mockImplementation(async () => {
        order.push('engine');
        return { content: 'xong' };
      });
      mockAgentStream.emitStep.mockImplementation(async (_ctx, step) => {
        order.push(`emit-${step.type}`);
      });
      mockEventLog.finish.mockImplementation(async (_id, status) => {
        order.push(`finish-${status}`);
      });

      await run();

      expect(order).toEqual([
        'start',
        'engine',
        'emit-done',
        'stop-heartbeat',
        'finish-done',
      ]);
      expect(mockEventLog.startHeartbeat).toHaveBeenCalledWith('approval-msg-log');
    });

    it('chốt CANCELLED khi bị huỷ và FAILED khi lỗi (nhịp tim luôn được dừng)', async () => {
      const stop = jest.fn();
      mockEventLog.startHeartbeat.mockReturnValue(stop);

      mockTurnResolver.continueRounds.mockRejectedValueOnce(new TurnCancelledError('dở'));
      await run();
      expect(mockEventLog.finish).toHaveBeenLastCalledWith(
        'approval-msg-log',
        ETurnLogStatus.CANCELLED,
      );

      mockTurnResolver.continueRounds.mockRejectedValueOnce(new Error('LLM down'));
      await run();
      expect(mockEventLog.finish).toHaveBeenLastCalledWith(
        'approval-msg-log',
        ETurnLogStatus.FAILED,
      );
      expect(stop).toHaveBeenCalledTimes(2);
    });
  });

});
