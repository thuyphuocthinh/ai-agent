import { Test, TestingModule } from '@nestjs/testing';
import { EJobName, EQueueName, QueueService } from '@agent/core/infrastructure/queue';
import { EApprovalAction, ECheckpointKind } from '@agent/core/constants';
import { ApprovalRequestService } from './approval-request.service';
import { MessageClientService } from '../../contracts/message-client.service';
import { AgentStreamService } from '../../contracts/agent-stream.service';
import { CheckpointService } from './checkpoint.service';
import { OrchestrationCheckpointStatus } from '../../infrastructure/database/entities/orchestration-checkpoint.entity';
import { ETurnLogStatus, TURN_EVENT_LOG } from '../../contracts';
import { TurnEventRecorderService } from '../orchestrator/turn-event-recorder.service';

describe('ApprovalRequestService', () => {
  let service: ApprovalRequestService;

  const mockMessageClient = { updateMessage: jest.fn() };
  const mockAgentStream = { emitStep: jest.fn() };
  const mockCheckpoint = {
    findPendingByReplyMessageId: jest.fn(),
    claim: jest.fn(),
    revertApprovedClaim: jest.fn(),
  };
  const mockQueueService = { addJob: jest.fn() };
  const mockEventLog = { start: jest.fn(), finish: jest.fn() };
  const mockTurnRecorder = { idle: jest.fn() };

  beforeEach(async () => {
    mockMessageClient.updateMessage.mockResolvedValue(undefined);
    mockAgentStream.emitStep.mockResolvedValue(undefined);
    mockCheckpoint.claim.mockResolvedValue({ claimed: true });
    mockCheckpoint.revertApprovedClaim.mockResolvedValue(undefined);
    mockQueueService.addJob.mockResolvedValue({ id: 'job-1' });
    mockEventLog.start.mockResolvedValue(undefined);
    mockEventLog.finish.mockResolvedValue(undefined);
    mockTurnRecorder.idle.mockResolvedValue(undefined);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ApprovalRequestService,
        { provide: MessageClientService, useValue: mockMessageClient },
        { provide: AgentStreamService, useValue: mockAgentStream },
        { provide: CheckpointService, useValue: mockCheckpoint },
        { provide: QueueService, useValue: mockQueueService },
        { provide: TURN_EVENT_LOG, useValue: mockEventLog },
        { provide: TurnEventRecorderService, useValue: mockTurnRecorder },
      ],
    }).compile();

    service = module.get<ApprovalRequestService>(ApprovalRequestService);
  });

  afterEach(() => jest.clearAllMocks());

  describe('resolveApproval (Giai đoạn 3 — HITL, Step 5)', () => {
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

    it('reject: marks the checkpoint rejected, edits the message, does NOT enqueue any job', async () => {
      mockCheckpoint.findPendingByReplyMessageId.mockResolvedValue(checkpoint);

      await service.resolveApproval({
        userId: 'user-1',
        messageId: 'approval-msg-1',
        action: 'reject',
      });

      expect(mockCheckpoint.claim).toHaveBeenCalledWith({
        id: 'checkpoint-1',
        toStatus: OrchestrationCheckpointStatus.REJECTED,
      });
      expect(mockMessageClient.updateMessage).toHaveBeenCalledWith({
        id: 'approval-msg-1',
        userId: 'bot-1',
        content: '❌ Đã huỷ theo yêu cầu.',
      });
      expect(mockQueueService.addJob).not.toHaveBeenCalled();
      expect(mockAgentStream.emitStep).toHaveBeenCalledWith(
        {
          userId: 'user-1',
          channelId: 'channel-1',
          messageId: 'approval-msg-1',
          channelType: 'direct',
        },
        { type: 'done' },
      );
    });

    it('reject: turn từ chối có event log — ACTIVE trước khi ghi "Đã huỷ", recorder xong rồi mới phát done, chốt DONE sau cùng', async () => {
      const order: string[] = [];
      mockCheckpoint.findPendingByReplyMessageId.mockResolvedValue(checkpoint);
      mockEventLog.start.mockImplementation(async (dto) => {
        order.push('start');
        expect(dto).toEqual({
          messageId: 'approval-msg-1',
          conversationId: 'channel-1',
          userId: 'user-1',
        });
      });
      mockMessageClient.updateMessage.mockImplementation(async () => {
        order.push('update');
      });
      mockTurnRecorder.idle.mockImplementation(async () => {
        order.push('recorder-idle');
      });
      mockAgentStream.emitStep.mockImplementation(async (_ctx, step) => {
        order.push(`emit-${step.type}`);
      });
      mockEventLog.finish.mockImplementation(async (_id, status) => {
        order.push(`finish-${status}`);
      });

      await service.resolveApproval({
        userId: 'user-1',
        messageId: 'approval-msg-1',
        action: 'reject',
      });

      expect(order).toEqual(['start', 'update', 'recorder-idle', 'emit-done', 'finish-done']);
    });

    it('reject: ghi message lỗi thì vẫn phát done, chốt FAILED và ném lại lỗi (không treo stream)', async () => {
      mockCheckpoint.findPendingByReplyMessageId.mockResolvedValue(checkpoint);
      mockMessageClient.updateMessage.mockRejectedValue(new Error('db down'));

      await expect(
        service.resolveApproval({
          userId: 'user-1',
          messageId: 'approval-msg-1',
          action: 'reject',
        }),
      ).rejects.toThrow('db down');

      expect(mockAgentStream.emitStep).toHaveBeenCalledWith(
        expect.objectContaining({ messageId: 'approval-msg-1' }),
        { type: 'done' },
      );
      expect(mockEventLog.finish).toHaveBeenCalledWith('approval-msg-1', ETurnLogStatus.FAILED);
    });

    it('approve: không tự tạo log ở đây (log của turn chạy tiếp do ApprovalExecutionService đảm nhiệm)', async () => {
      mockCheckpoint.findPendingByReplyMessageId.mockResolvedValue(checkpoint);

      await service.resolveApproval({
        userId: 'user-1',
        messageId: 'approval-msg-1',
        action: 'approve',
      });

      expect(mockEventLog.start).not.toHaveBeenCalled();
      expect(mockEventLog.finish).not.toHaveBeenCalled();
    });

    it('approve: claims the checkpoint then enqueues a background job instead of running the tool inline (fast HTTP response)', async () => {
      mockCheckpoint.findPendingByReplyMessageId.mockResolvedValue(checkpoint);

      await service.resolveApproval({
        userId: 'user-1',
        messageId: 'approval-msg-1',
        action: 'approve',
      });

      expect(mockCheckpoint.claim).toHaveBeenCalledWith({
        id: 'checkpoint-1',
        toStatus: OrchestrationCheckpointStatus.APPROVED,
      });
      // attempts:1 — mcpClient.callTool() không idempotent, không được để queue tự retry chạy lại tool THẬT lần 2.
      expect(mockQueueService.addJob).toHaveBeenCalledWith(
        EQueueName.AI_ORCHESTRATION_QUEUE,
        EJobName.PROCESS_APPROVAL,
        { checkpointId: 'checkpoint-1', userId: 'user-1' },
        { attempts: 1 },
      );
      expect(mockMessageClient.updateMessage).not.toHaveBeenCalled();
    });

    it('edit_and_approve: correctly validates and passes updated pending tool to claim()', async () => {
      mockCheckpoint.findPendingByReplyMessageId.mockResolvedValue(checkpoint);

      await service.resolveApproval({
        userId: 'user-1',
        messageId: 'approval-msg-1',
        action: 'edit_and_approve',
        editedArgs: {
          query: "UPDATE Orders SET Status='Shipped' WHERE OrderId=1",
        },
      });

      expect(mockCheckpoint.claim).toHaveBeenCalledWith({
        id: 'checkpoint-1',
        toStatus: OrchestrationCheckpointStatus.APPROVED,
        updatedPendingTool: {
          provider: 'sql_server',
          name: 'execute_write_query',
          args: { query: "UPDATE Orders SET Status='Shipped' WHERE OrderId=1" },
        },
      });
      expect(mockQueueService.addJob).toHaveBeenCalled();
    });

    it('edit_and_approve: rejects if attempting to add new unknown keys to args', async () => {
      mockCheckpoint.findPendingByReplyMessageId.mockResolvedValue(checkpoint);

      await expect(
        service.resolveApproval({
          userId: 'user-1',
          messageId: 'approval-msg-1',
          action: 'edit_and_approve',
          editedArgs: {
            query: "UPDATE Orders SET Status='Shipped' WHERE OrderId=1",
            malicious_new_key: 'hacked',
          },
        }),
      ).rejects.toThrow();

      expect(mockCheckpoint.claim).not.toHaveBeenCalled();
    });

    it('edit_and_approve: rejects if attempting to inject forbidden values', async () => {
      mockCheckpoint.findPendingByReplyMessageId.mockResolvedValue(checkpoint);

      await expect(
        service.resolveApproval({
          userId: 'user-1',
          messageId: 'approval-msg-1',
          action: 'edit_and_approve',
          editedArgs: { query: '' }, // empty string is forbidden in validation
        }),
      ).rejects.toThrow();

      expect(mockCheckpoint.claim).not.toHaveBeenCalled();
    });

    it('approve: reverts the claim back to PENDING when enqueueing the job fails, instead of leaving it stuck APPROVED forever', async () => {
      mockCheckpoint.findPendingByReplyMessageId.mockResolvedValue(checkpoint);
      mockQueueService.addJob.mockRejectedValue(new Error('redis unreachable'));

      await expect(
        service.resolveApproval({
          userId: 'user-1',
          messageId: 'approval-msg-1',
          action: 'approve',
        }),
      ).rejects.toThrow();

      expect(mockCheckpoint.revertApprovedClaim).toHaveBeenCalledWith({
        id: 'checkpoint-1',
      });
    });

    it('throws CHECKPOINT_NOT_FOUND when there is no pending checkpoint for this message', async () => {
      mockCheckpoint.findPendingByReplyMessageId.mockResolvedValue(null);

      await expect(
        service.resolveApproval({
          userId: 'user-1',
          messageId: 'unknown-msg',
          action: 'approve',
        }),
      ).rejects.toThrow();
      expect(mockCheckpoint.claim).not.toHaveBeenCalled();
    });

    it('throws CHECKPOINT_FORBIDDEN when the requester is not the user who triggered the turn', async () => {
      mockCheckpoint.findPendingByReplyMessageId.mockResolvedValue(checkpoint);

      await expect(
        service.resolveApproval({
          userId: 'some-other-user',
          messageId: 'approval-msg-1',
          action: 'approve',
        }),
      ).rejects.toThrow();
      expect(mockCheckpoint.claim).not.toHaveBeenCalled();
    });

    it('throws CHECKPOINT_ALREADY_RESOLVED and never enqueues a job when another request already claimed it first (double-click / 2 tabs)', async () => {
      mockCheckpoint.findPendingByReplyMessageId.mockResolvedValue(checkpoint);
      mockCheckpoint.claim.mockResolvedValue({ claimed: false });

      await expect(
        service.resolveApproval({
          userId: 'user-1',
          messageId: 'approval-msg-1',
          action: 'approve',
        }),
      ).rejects.toThrow();
      expect(mockQueueService.addJob).not.toHaveBeenCalled();
      expect(mockMessageClient.updateMessage).not.toHaveBeenCalled();
    });

    it('accuracy_problem.md mục 1 — clarify: claims with selectedProvider then enqueues the same background job as approve', async () => {
      const clarificationCheckpoint = {
        ...checkpoint,
        kind: ECheckpointKind.CLARIFICATION,
      };
      mockCheckpoint.findPendingByReplyMessageId.mockResolvedValue(
        clarificationCheckpoint,
      );

      await service.resolveApproval({
        userId: 'user-1',
        messageId: 'approval-msg-1',
        action: EApprovalAction.CLARIFY,
        selectedProvider: 'notion',
      });

      expect(mockCheckpoint.claim).toHaveBeenCalledWith({
        id: 'checkpoint-1',
        toStatus: OrchestrationCheckpointStatus.APPROVED,
        selectedProvider: 'notion',
      });
      expect(mockQueueService.addJob).toHaveBeenCalledWith(
        EQueueName.AI_ORCHESTRATION_QUEUE,
        EJobName.PROCESS_APPROVAL,
        { checkpointId: 'checkpoint-1', userId: 'user-1' },
        { attempts: 1 },
      );
    });

    it('throws CHECKPOINT_ACTION_MISMATCH when action="clarify" but the checkpoint kind is "approval"', async () => {
      mockCheckpoint.findPendingByReplyMessageId.mockResolvedValue(checkpoint);

      await expect(
        service.resolveApproval({
          userId: 'user-1',
          messageId: 'approval-msg-1',
          action: EApprovalAction.CLARIFY,
          selectedProvider: 'notion',
        }),
      ).rejects.toThrow();
      expect(mockCheckpoint.claim).not.toHaveBeenCalled();
    });

    it('throws CHECKPOINT_ACTION_MISMATCH when action="clarify" but selectedProvider is missing', async () => {
      const clarificationCheckpoint = {
        ...checkpoint,
        kind: ECheckpointKind.CLARIFICATION,
      };
      mockCheckpoint.findPendingByReplyMessageId.mockResolvedValue(
        clarificationCheckpoint,
      );

      await expect(
        service.resolveApproval({
          userId: 'user-1',
          messageId: 'approval-msg-1',
          action: EApprovalAction.CLARIFY,
        }),
      ).rejects.toThrow();
      expect(mockCheckpoint.claim).not.toHaveBeenCalled();
    });

    it('throws CHECKPOINT_ACTION_MISMATCH when action="approve" but the checkpoint kind is "clarification"', async () => {
      const clarificationCheckpoint = {
        ...checkpoint,
        kind: ECheckpointKind.CLARIFICATION,
      };
      mockCheckpoint.findPendingByReplyMessageId.mockResolvedValue(
        clarificationCheckpoint,
      );

      await expect(
        service.resolveApproval({
          userId: 'user-1',
          messageId: 'approval-msg-1',
          action: EApprovalAction.APPROVE,
        }),
      ).rejects.toThrow();
      expect(mockCheckpoint.claim).not.toHaveBeenCalled();
    });
  });
});
