import { Inject, Optional } from '@nestjs/common';
import { Processor } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { RpcException } from '@nestjs/microservices';
import { traceable } from 'langsmith/traceable';
import {
  BaseProcessor,
  EJobName,
  EQueueName,
  IProcessAiTriggerJobData,
  IProcessApprovalJobData,
} from '@agent/core/infrastructure/queue';
import {
  ORCHESTRATION_CONSTANTS,
  ORCHESTRATION_ERROR,
  EAgentStreamStepType,
} from '@agent/core/constants';
import {
  IMessageSink,
  MESSAGE_SINK,
  IStreamSink,
  STREAM_SINK,
  UpdateOrchestrationMessageRequestDto,
  ETurnLogStatus,
  ITurnEventLog,
  TURN_EVENT_LOG,
} from '../../../contracts';
import { AnswerResult } from '../../../contracts/engine/orchestration-answer.types';
import { ReducedTurnLog, reduceTurnLog } from '../../../contracts/streaming/turn-log-reducer';
import { TurnEventRecorderService } from '../turn/turn-event-recorder.service';
import { describeExternalServiceError } from '../../loop/utils/external-service-error.util';
import { CancelTurnRequestDto } from '../../../contracts/dtos/orchestration.dto';
import { TriggerClaimService } from '../../hitl/trigger-claim.service';
import { AgentCancellationService } from '../../cancellation/agent-cancellation.service';
import { TurnCancelledError } from '../../loop/errors/turn-cancelled.error';
import { TurnResolverService } from '../turn/turn-resolver.service';
import { ApprovalExecutionService } from '../../hitl/approval-execution.service';
import { ConversationCompactionService } from '../context/conversation-compaction.service';
import {
  ITracerService,
  TRACER_SERVICE,
  GEN_AI_ATTRIBUTES,
} from '../../../contracts/observability';

type AiOrchestrationJobData =
  | IProcessAiTriggerJobData
  | IProcessApprovalJobData;

// Chỉ còn lo vòng đời job/turn (claim, placeholder message, trace, catch/finally
// hiển thị kết quả) — vòng lặp Supervisor nằm ở TurnResolverService, toàn bộ
// luồng duyệt/thực thi HITL nằm ở ApprovalRequestService/ApprovalExecutionService.
@Processor(EQueueName.AI_ORCHESTRATION_QUEUE, {
  concurrency: ORCHESTRATION_CONSTANTS.AI_ORCHESTRATION_QUEUE_CONCURRENCY,
  lockDuration: 60000,
  maxStalledCount: 1,
})
export class AiOrchestrationProcessor extends BaseProcessor<
  AiOrchestrationJobData,
  void,
  EJobName
> {
  constructor(
    @Inject(MESSAGE_SINK)
    private readonly messageSink: IMessageSink,
    @Inject(STREAM_SINK)
    private readonly streamSink: IStreamSink,
    private readonly triggerClaim: TriggerClaimService,
    private readonly cancellation: AgentCancellationService,
    private readonly turnResolver: TurnResolverService,
    private readonly approvalExecution: ApprovalExecutionService,
    @Optional()
    @Inject(TURN_EVENT_LOG)
    private readonly eventLog?: ITurnEventLog,
    @Optional()
    private readonly turnRecorder?: TurnEventRecorderService,
    @Optional()
    @Inject(TRACER_SERVICE)
    private readonly tracer?: ITracerService,
    @Optional()
    private readonly compactionService?: ConversationCompactionService,
  ) {
    super();
  }

  private get messageClient(): IMessageSink {
    return this.messageSink;
  }

  private get agentStream(): IStreamSink {
    return this.streamSink;
  }

  async process(
    job: Job<AiOrchestrationJobData, void, EJobName>,
  ): Promise<void> {
    switch (job.name) {
      case EJobName.PROCESS_AI_TRIGGER: {
        await this.handleAiTrigger(job.data as IProcessAiTriggerJobData);
        break;
      }
      case EJobName.PROCESS_APPROVAL: {
        const data = job.data as IProcessApprovalJobData;
        // Cùng lý do handleAiTrigger() — thiếu cái này thì processApprovalJob()
        // (và mọi sendMessage/generateStructured/callTool bên trong nó, xuyên
        // qua continueRounds()) chạy KHÔNG có root trace nào bao quanh, mỗi lời
        // gọi tự thành 1 trace gốc rời rạc thay vì nest chung 1 cây — bug thật
        // gặp khi 1 turn phải duyệt (approve) nhiều lần: mỗi lần duyệt tạo ra
        // hàng loạt trace lẻ (openai.sendMessage, mcp.callTool...) không liên
        // kết, thay vì đúng "1 lần duyệt = 1 trace".
        const traced = traceable(
          (d: IProcessApprovalJobData) =>
            this.approvalExecution.processApprovalJob(d),
          {
            name: 'ai-orchestration-approval',
            metadata: { checkpointId: data.checkpointId, userId: data.userId },
          },
        );
        if (this.tracer) {
          await this.tracer.withSpan(
            'ai-orchestration-approval',
            async (span) => {
              span.setAttributes({
                [GEN_AI_ATTRIBUTES.AGENT_USER_ID]: data.userId,
                [GEN_AI_ATTRIBUTES.AGENT_MESSAGE_ID]: data.checkpointId,
                [GEN_AI_ATTRIBUTES.OPERATION_NAME]: 'ai-orchestration-approval',
              });
              await traced(data);
            },
            { root: true },
          );
        } else {
          await traced(data);
        }
        break;
      }
      default:
        this.logger.warn(`Unknown job name: ${job.name}`);
        throw new Error(`Job name ${job.name} is not supported`);
    }
  }

  // Mỗi turn độc lập hoàn toàn (checkpoint khoá theo replyMessageId, không
  // theo channel) — không chặn tin nhắn mới dù channel đang có checkpoint
  // pending khác (Step 8, đã revise: chặn từng làm rớt câu hỏi của user khác).
  private async handleAiTrigger(data: IProcessAiTriggerJobData): Promise<void> {
    const userId = data.userId;
    const channelId = data.conversationId ?? data.channelId;
    const workspaceId = data.tenantId ?? data.workspaceId ?? 'default';
    const messageId = data.messageId;
    const botUserId = data.botUserId ?? 'agent-bot';
    const channelType = data.sessionType ?? data.channelType ?? 'direct';

    // Giai đoạn 4, Step 1 — claim atomic (insert-once) TRƯỚC khi tạo message
    // placeholder. Nếu job này bị BullMQ retry/redeliver (lỗi tạm thời, worker
    // crash giữa chừng) cho CÙNG messageId, lần chạy sau claim() thất bại và bỏ
    // qua — tránh tạo thêm 1 message "Đang xử lý..." trùng.
    const claimed = await this.triggerClaim.claim(messageId);
    if (!claimed) {
      this.logger.warn(
        `handleAiTrigger() messageId=${messageId} đã được claim trước đó — bỏ qua (job bị retry/redeliver)`,
      );
      return;
    }

    // Giai đoạn hardening — createMessage()/startTurn() lỗi (VD message-service
    // chập chờn) TRƯỚC KHI có reply message thật sẽ làm cả handleAiTrigger()
    // throw, BullMQ retry, nhưng claim() ở trên đã chặn MỌI lần retry sau —
    // turn bị mất tích im lặng vĩnh viễn, user không nhận được gì cả. Release
    // claim TRƯỚC KHI rethrow — chưa có gì thật được tạo nên retry lúc này an
    // toàn tuyệt đối, không tạo trùng gì.
    let reply: { id: string };
    try {
      reply = await this.messageClient.createMessage({
        channelId,
        senderId: botUserId,
        content: '🤖 Đang xử lý...',
      });
      // Ghi lại chủ turn NGAY khi bắt đầu chạy — endpoint Stop cần biết ai
      // được phép huỷ (chỉ đúng userId này), và vòng lặp bên trong cần biết
      // khoá Redis nào để tự kiểm tra (đều khoá theo reply.id, xem
      // AgentCancellationService).
      await this.cancellation.startTurn(reply.id, userId);
    } catch (error) {
      this.logger.error(
        `handleAiTrigger() lỗi TRƯỚC KHI tạo được reply message cho ${messageId}: ${(error as Error).message}`,
        (error as Error).stack,
      );
      await this.triggerClaim.release(messageId);
      throw error;
    }

    // Turn phải ACTIVE trong event log NGAY từ đây: reload trang trước event đầu
    // tiên (LLM đang suy nghĩ) vẫn reconnect được và phát lại từ đầu.
    await this.eventLog
      ?.start({ messageId: reply.id, conversationId: channelId, userId })
      .catch((error: unknown) =>
        this.logger.warn(
          `Không thể khởi tạo turn log cho ${reply.id}: ${(error as Error)?.message}`,
        ),
      );

    // traceable() lồng theo AsyncLocalStorage — 1 root trace/turn, tự nest mọi span con.
    const traced = traceable(
      (d: IProcessAiTriggerJobData, replyId: string) =>
        this.turnResolver.resolveAnswer(d, replyId),
      {
        name: 'ai-orchestration-turn',
        metadata: {
          userId,
          channelId,
          workspaceId,
          messageId: reply.id,
          triggerMessageId: messageId,
        },
      },
    );

    const stopHeartbeat = this.eventLog?.startHeartbeat(reply.id);
    const startTimeMs = Date.now();
    let finalStatus = ETurnLogStatus.DONE;
    try {
      const executeTurn = () => traced(data, reply.id);
      const result = this.tracer
        ? await this.tracer.withSpan(
            'ai-orchestration-turn',
            async (span) => {
              span.setAttributes({
                [GEN_AI_ATTRIBUTES.AGENT_USER_ID]: userId,
                [GEN_AI_ATTRIBUTES.AGENT_CONVERSATION_ID]: channelId,
                [GEN_AI_ATTRIBUTES.AGENT_WORKSPACE_ID]: workspaceId,
                [GEN_AI_ATTRIBUTES.AGENT_MESSAGE_ID]: reply.id,
                [GEN_AI_ATTRIBUTES.AGENT_TURN_ID]: messageId,
                [GEN_AI_ATTRIBUTES.OPERATION_NAME]: 'ai-orchestration-turn',
              });
              return executeTurn();
            },
            { root: true },
          )
        : await executeTurn();

      await this.batchFlushSuccess(
        reply.id,
        botUserId,
        channelId,
        result,
        Date.now() - startTimeMs,
      );
    } catch (error) {
      if (error instanceof TurnCancelledError) {
        this.logger.log(
          `handleAiTrigger() messageId=${messageId} bị huỷ theo yêu cầu (Stop)`,
        );
        finalStatus = ETurnLogStatus.CANCELLED;
        await this.batchFlushCancelled(reply.id, botUserId, error.partialText);
      } else {
        finalStatus = ETurnLogStatus.FAILED;
        this.logger.error(
          `AI orchestration failed for message ${messageId}: ${(error as Error)?.message}`,
          (error as Error)?.stack,
        );
        await this.batchFlushFailed(reply.id, botUserId, error);
      }
    } finally {
      // Chunk câu trả lời/duyệt/làm rõ phải nằm trong log TRƯỚC event done.
      await this.turnRecorder?.idle();
      // Luôn báo "done" — FE dựa vào đây để tắt icon "đang chạy tool...".
      await this.agentStream
        .emitStep(
          { userId, channelId, messageId: reply.id, channelType },
          { type: EAgentStreamStepType.DONE },
        )
        .catch((error) =>
          this.logger.warn(
            `emitStep('done') failed: ${(error as Error).message}`,
          ),
        );
      stopHeartbeat?.();
      await this.eventLog?.finish(reply.id, finalStatus);
      if (finalStatus === ETurnLogStatus.DONE && channelId) {
        this.compactionService?.scheduleCompaction(channelId);
      }
    }
  }

  // Phần dở dang của turn (text/steps/toolCalls) tổng hợp từ event log — dùng khi
  // engine không trả đủ (huỷ/lỗi). Lỗi đọc log không được làm hỏng việc lưu DB.
  private async reduceLog(replyId: string): Promise<ReducedTurnLog | undefined> {
    if (!this.eventLog) return undefined;
    try {
      return reduceTurnLog(await this.eventLog.snapshot(replyId));
    } catch (err: unknown) {
      this.logger.warn(
        `Không đọc được turn log của ${replyId}: ${(err as Error)?.message}`,
      );
      return undefined;
    }
  }

  private async batchFlushSuccess(
    replyId: string,
    botUserId: string,
    channelId?: string,
    result?: AnswerResult,
    executionTimeMs?: number,
  ): Promise<void> {
    const logged =
      result?.steps && result?.toolCalls ? undefined : await this.reduceLog(replyId);
    // Mảng rỗng không phải dữ liệu: ghi [] xuống DB sẽ che mất toolCalls ở FE.
    const steps = result?.steps ?? (logged?.steps.length ? logged.steps : undefined);
    const toolCalls =
      result?.toolCalls ?? (logged?.toolCalls.length ? logged.toolCalls : undefined);

    const payload: UpdateOrchestrationMessageRequestDto = {
      id: replyId,
      userId: botUserId,
      channelId,
      content: result?.content ?? '',
      executionTimeMs,
    };
    if (steps !== undefined) payload.steps = steps;
    if (toolCalls !== undefined) payload.toolCalls = toolCalls;
    if (result?.persona) payload.persona = result.persona;
    if (result?.personas) payload.personas = result.personas;
    if (result?.routing) payload.routing = result.routing;

    await this.messageClient.updateMessage(payload);
  }

  private async batchFlushCancelled(
    replyId: string,
    botUserId: string,
    partialText?: string,
  ): Promise<void> {
    const logged = await this.reduceLog(replyId);
    const content = partialText || logged?.partialText || '⏹️ Đã dừng theo yêu cầu.';

    const payload: UpdateOrchestrationMessageRequestDto = {
      id: replyId,
      userId: botUserId,
      content,
    };
    if (logged?.steps.length) payload.steps = logged.steps;
    if (logged?.toolCalls.length) payload.toolCalls = logged.toolCalls;

    await this.messageClient.tryUpdateMessage(payload);
  }

  private async batchFlushFailed(
    replyId: string,
    botUserId: string,
    error?: unknown,
  ): Promise<void> {
    const logged = await this.reduceLog(replyId);
    const errorMsg = describeExternalServiceError(error);
    const content =
      logged?.partialText && logged.partialText.trim().length > 0
        ? `${logged.partialText.trim()}

⚠️ *[Đã dừng do sự cố]*: ${errorMsg}`
        : errorMsg;

    const payload: UpdateOrchestrationMessageRequestDto = {
      id: replyId,
      userId: botUserId,
      content,
    };
    if (logged?.steps.length) payload.steps = logged.steps;
    if (logged?.toolCalls.length) payload.toolCalls = logged.toolCalls;

    await this.messageClient.tryUpdateMessage(payload);
  }

  // Chỉ đặt cờ huỷ vào Redis rồi trả về ngay — vòng lặp đang chạy (ReactLoop
  // hoặc round loop của TurnResolverService) tự phát hiện qua isCancelled()/signal,
  // không có gì để "chờ" ở đây cả.
  async cancelTurn(dto: CancelTurnRequestDto): Promise<void> {
    const owner = await this.cancellation.getOwner(dto.messageId);
    if (!owner) {
      throw new RpcException(ORCHESTRATION_ERROR.TURN_NOT_FOUND);
    }
    if (owner !== dto.userId) {
      this.logger.warn(
        `User ${dto.userId} tried to stop turn ${dto.messageId} owned by ${owner}`,
      );
      throw new RpcException(ORCHESTRATION_ERROR.TURN_FORBIDDEN);
    }
    await this.cancellation.requestCancel(dto.messageId);
  }
}
