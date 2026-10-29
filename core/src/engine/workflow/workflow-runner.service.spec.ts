import { WorkflowRunnerService } from './workflow-runner.service';
import { ReactLoopService } from '../loop/react-loop.service';
import { IStreamSink } from '../../contracts';
import { AgentCancellationService } from '../cancellation/agent-cancellation.service';
import { CheckpointPauseService } from '../hitl/checkpoint-pause.service';
import { MetricsRegistryService } from '../../infrastructure/resilience/metrics-registry.service';
import { TurnCancelledError } from '../loop/errors/turn-cancelled.error';
import { ApprovalRequiredError } from '../loop/errors/approval-required.error';
import { AgentWorkflowConfig, createWorkflow } from '../../contracts';
import { IProcessAiTriggerJobData } from '../../contracts/queue/job-data.interface';

describe('WorkflowRunnerService', () => {
  let service: WorkflowRunnerService;
  let reactLoop: jest.Mocked<ReactLoopService>;
  let streamSink: jest.Mocked<IStreamSink>;
  let cancellation: jest.Mocked<AgentCancellationService>;
  let checkpointPause: jest.Mocked<CheckpointPauseService>;
  let metrics: jest.Mocked<MetricsRegistryService>;

  const mockWorkflow: AgentWorkflowConfig = createWorkflow({
    id: 'test-wf',
    name: 'Test Workflow',
    description: 'Test workflow description',
    systemPrompt: 'You are a test agent.',
    tools: ['test_tool_1', 'test_tool_2'],
    provider: 'sql_server',
  });

  const mockJobData: IProcessAiTriggerJobData = {
    userId: 'user-123',
    channelId: 'chan-123',
    conversationId: 'conv-123',
    workspaceId: 'ws-123',
    tenantId: 'tenant-123',
    messageId: 'user-msg-123',
    botUserId: 'bot-123',
    sessionType: 'web',
    channelType: 'web',
    workflowId: 'test-wf',
  };

  beforeEach(() => {
    reactLoop = {
      run: jest.fn(),
    } as unknown as jest.Mocked<ReactLoopService>;

    streamSink = {
      emitStep: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<IStreamSink>;

    cancellation = {
      isCancelled: jest.fn().mockResolvedValue(false),
    } as unknown as jest.Mocked<AgentCancellationService>;

    checkpointPause = {
      pauseForApproval: jest.fn(),
    } as unknown as jest.Mocked<CheckpointPauseService>;

    metrics = {
      incrementBehaviorSignal: jest.fn(),
    } as unknown as jest.Mocked<MetricsRegistryService>;

    service = new WorkflowRunnerService(
      reactLoop,
      streamSink,
      cancellation,
      checkpointPause,
      metrics,
    );
  });

  describe('runWorkflow()', () => {
    it('thực thi trực tiếp ReactLoop với persona và allowedTools của workflow, bỏ qua Supervisor', async () => {
      reactLoop.run.mockResolvedValue({
        answer: 'Chào bạn, kết quả đây.',
        toolCalls: [
          { tool: 'test_tool_1', status: 'success' as any, resultPreview: 'ok' },
        ],
      });

      const result = await service.runWorkflow({
        workflow: mockWorkflow,
        prompt: 'Tra cứu thông tin',
        data: mockJobData,
        replyMessageId: 'reply-456',
        history: [],
      });

      expect(result.content).toBe('Chào bạn, kết quả đây.');
      expect(result.toolCalls?.length).toBe(1);
      expect(reactLoop.run).toHaveBeenCalledTimes(1);

      const callArg = reactLoop.run.mock.calls[0][0];
      expect(callArg.prompt).toBe('Tra cứu thông tin');
      expect(callArg.provider).toBe('sql_server');
      expect(callArg.allowedTools).toEqual(['test_tool_1', 'test_tool_2']);
      expect(callArg.persona).toEqual({
        role: 'Test Workflow',
        goal: 'You are a test agent.',
      });
    });

    it('ném TurnCancelledError khi signal đã bị aborted trước đó', async () => {
      const controller = new AbortController();
      controller.abort();

      await expect(
        service.runWorkflow({
          workflow: mockWorkflow,
          prompt: 'Tra cứu',
          data: mockJobData,
          replyMessageId: 'reply-456',
          history: [],
          signal: controller.signal,
        }),
      ).rejects.toThrow(TurnCancelledError);

      expect(reactLoop.run).not.toHaveBeenCalled();
    });

    it('ném TurnCancelledError khi cancellation service báo turn đã bị huỷ', async () => {
      cancellation.isCancelled.mockResolvedValue(true);

      await expect(
        service.runWorkflow({
          workflow: mockWorkflow,
          prompt: 'Tra cứu',
          data: mockJobData,
          replyMessageId: 'reply-456',
          history: [],
        }),
      ).rejects.toThrow(TurnCancelledError);

      expect(reactLoop.run).not.toHaveBeenCalled();
    });

    it('bắt ApprovalRequiredError và gọi CheckpointPauseService.pauseForApproval khi gặp tool cần duyệt', async () => {
      const pendingTool = {
        provider: 'google_mail',
        name: 'send_email',
        args: { to: 'boss@corp.com', subject: 'Report' },
      };
      const approvalError = new ApprovalRequiredError(pendingTool, [
        { tool: 'send_email', status: 'awaiting_approval' as any },
      ]);

      reactLoop.run.mockRejectedValue(approvalError);
      checkpointPause.pauseForApproval.mockResolvedValue({
        content: 'Yêu cầu duyệt đã được tạo.',
        toolCalls: approvalError.toolCalls,
      });

      const result = await service.runWorkflow({
        workflow: mockWorkflow,
        prompt: 'Gửi báo cáo',
        data: mockJobData,
        replyMessageId: 'reply-456',
        history: [],
      });

      expect(metrics.incrementBehaviorSignal).toHaveBeenCalledWith('approval_required');
      expect(checkpointPause.pauseForApproval).toHaveBeenCalledTimes(1);
      expect(result.content).toBe('Yêu cầu duyệt đã được tạo.');
    });

    it('propagate các lỗi ngoại lệ khác ra ngoài', async () => {
      reactLoop.run.mockRejectedValue(new Error('LLM connection failed'));

      await expect(
        service.runWorkflow({
          workflow: mockWorkflow,
          prompt: 'Tra cứu',
          data: mockJobData,
          replyMessageId: 'reply-456',
          history: [],
        }),
      ).rejects.toThrow('LLM connection failed');
    });
  });
});
