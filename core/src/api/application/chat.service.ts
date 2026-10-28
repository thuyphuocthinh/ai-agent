import {
  HttpException,
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import type { UIMessageChunk } from 'ai';
import {
  EApprovalAction,
  ECheckpointKind,
  EMessageRole,
  EVercelStreamChunkType,
} from '@agent/core/constants';
import {
  EJobName,
  EQueueName,
  IProcessAiTriggerJobData,
  IQueueDispatcher,
  QUEUE_DISPATCHER,
} from '@agent/core/infrastructure/queue';
import { ApprovalRequestService } from '../../engine/hitl/approval-request.service';
import {
  ActiveTurn,
  CHAT_SESSION_MANAGER,
  IChatSessionManager,
  IMessageSink,
  MESSAGE_SINK,
  TurnStream,
  EConversationState,
  IConversationSummary,
  ETurnLogStatus,
  ITurnEventLog,
  TURN_EVENT_LOG,
  TurnLogMeta,
} from '../../contracts';
import { reduceTurnLog } from '../../contracts/turn-log-reducer';
import { ChatHistoryTurnDto } from '../../contracts/dtos/message-client.dto';
import {
  CursorPaginationQueryDto,
  CursorPageMetaDto,
  PaginatedResult,
} from '../presentation/dtos/pagination.dto';
import { TurnStreamFactory } from './turn-stream.factory';
import { OrchestrationRpcExceptionFilter } from '../presentation/filters/orchestration-exception.filter';
import { formatActionSummary } from '../../common/action-summary';
import { IPendingApprovalDto } from '../presentation/dtos/history-response.dto';
import {
  PromptInjectionGuard,
  SemanticPolicyEvaluatorService,
  HumanEscalationService,
  BusinessPolicyViolationError,
  EPolicyVerdict,
} from '../../security';
import {
  ChatSessionNotFoundException,
  StreamReconnectInvalidException,
  ApprovalRequestNotFoundException,
} from '../../common/errors';
import { IChatSession } from '../../contracts/chat-session.interface';

const HISTORY_LIMIT = 200;

@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);
  private readonly exceptionFilter = new OrchestrationRpcExceptionFilter();

  constructor(
    @Inject(CHAT_SESSION_MANAGER)
    private readonly sessionManager: IChatSessionManager,
    private readonly streamFactory: TurnStreamFactory,
    @Inject(QUEUE_DISPATCHER)
    private readonly queueDispatcher: IQueueDispatcher,
    @Inject(MESSAGE_SINK)
    private readonly messages: IMessageSink,
    private readonly approvals: ApprovalRequestService,
    @Optional()
    private readonly injectionGuard?: PromptInjectionGuard,
    @Optional()
    private readonly semanticPolicyEvaluator?: SemanticPolicyEvaluatorService,
    @Optional()
    private readonly humanEscalation?: HumanEscalationService,
    @Optional()
    @Inject(TURN_EVENT_LOG)
    private readonly eventLog?: ITurnEventLog,
  ) {}

  async chat(
    prompt: string,
    sessionId?: string,
    workflowId?: string,
  ): Promise<TurnStream> {
    const session = await this.sessionManager.getOrCreate(sessionId);

    const safePrompt = this.injectionGuard
      ? this.injectionGuard.assertSafe(prompt)
      : prompt;

    if (!session.title || session.title === 'Cuộc trò chuyện mới') {
      const generatedTitle = this.generateConversationTitle(safePrompt);
      if (this.sessionManager.updateTitle) {
        void this.sessionManager.updateTitle(session.id, generatedTitle).catch((err) => {
          this.logger.warn(`Không thể cập nhật tiêu đề cuộc trò chuyện: ${(err as Error)?.message}`);
        });
      }
    }

    const userMessage = await this.messages.addUserMessage({
      conversationId: session.conversationId,
      text: safePrompt,
    });

    const state =
      (await this.sessionManager.getConversationState?.(session.id)) ??
      session.state;

    if (state === EConversationState.HUMAN_TAKEOVER) {
      this.logger.log(
        `Session ${session.id} is in HUMAN_TAKEOVER state. AI Mute active - skipping AI orchestration.`,
      );
      const turn = this.streamFactory.createTurn(session);
      turn.close();
      return { sessionId: session.id, stream: turn.stream, cancel: turn.cancel, close: turn.close };
    }

    const turn = this.streamFactory.createTurn(session);

    const data: IProcessAiTriggerJobData = {
      userId: session.userId,
      channelId: session.conversationId,
      conversationId: session.conversationId,
      workspaceId: session.tenantId,
      tenantId: session.tenantId,
      messageId: userMessage.id,
      botUserId: session.botUserId,
      sessionType: 'web',
      channelType: 'web',
      workflowId,
    };

    void this.queueDispatcher
      .dispatch(
        EQueueName.AI_ORCHESTRATION_QUEUE,
        EJobName.PROCESS_AI_TRIGGER,
        data,
      )
      .catch((error) => {
        this.logger.error(`Turn dispatch failed: ${error?.message}`);
        return turn.fail(error);
      });

    return { sessionId: session.id, stream: turn.stream, cancel: turn.cancel, close: turn.close };
  }

  async approve(
    sessionId: string,
    messageId: string,
    action: EApprovalAction,
    selectedProvider?: string,
  ): Promise<TurnStream> {
    const session = await this.sessionManager.get(sessionId);
    if (!session) throw new ChatSessionNotFoundException(sessionId);

    let hasApproval = session.approvalMessageIds.has(messageId);
    if (!hasApproval && this.sessionManager.hasApproval) {
      hasApproval = await this.sessionManager.hasApproval(sessionId, messageId);
    }
    if (!hasApproval) {
      const checkpoint = await this.approvals.findPendingCheckpoint?.(messageId);
      if (
        checkpoint &&
        (checkpoint.conversationId === sessionId ||
          checkpoint.conversationId === session.conversationId)
      ) {
        hasApproval = true;
        session.approvalMessageIds.add(messageId);
        await this.sessionManager.trackApproval?.(sessionId, messageId);
      }
    }

    if (!hasApproval) {
      throw new ApprovalRequestNotFoundException(messageId);
    }

    const turn = this.streamFactory.createTurn(session, messageId);
    try {
      await this.approvals.resolveApproval({
        userId: session.userId,
        messageId,
        action,
        selectedProvider,
      });
    } catch (error) {
      turn.close();
      throw this.toHttpException(error);
    }
    return { sessionId: session.id, stream: turn.stream, cancel: turn.cancel, close: turn.close };
  }

  async getPendingApproval(conversationId: string): Promise<IPendingApprovalDto | null> {
    try {
      if (typeof this.approvals?.findPendingByConversationId !== 'function') {
        return null;
      }
      const checkpoint = await this.approvals.findPendingByConversationId(conversationId);
      if (!checkpoint) return null;
      const pendingTool = (checkpoint.pendingTool as { provider?: string; name?: string; args?: Record<string, unknown> } | null) ?? undefined;
      const isClarification = checkpoint.kind === ECheckpointKind.CLARIFICATION;
      const friendlySummary = isClarification
        ? (checkpoint.pendingTask || 'Cần bạn làm rõ yêu cầu để tiếp tục')
        : (pendingTool && pendingTool.provider && pendingTool.name
            ? formatActionSummary({
                provider: pendingTool.provider,
                toolName: pendingTool.name,
                args: pendingTool.args ?? {},
              })
            : 'Cần bạn duyệt hành động này trước khi tiếp tục');

      return {
        messageId: checkpoint.replyMessageId,
        tool: (checkpoint.pendingTool as unknown as Record<string, unknown>) || {},
        preview: checkpoint.pendingTask || checkpoint.originalPrompt,
        friendlySummary,
        kind: checkpoint.kind,
        candidates: checkpoint.clarificationCandidates ?? undefined,
      };
    } catch (err) {
      this.logger.warn(`Lỗi khi truy vấn pending checkpoint cho conversation ${conversationId}: ${(err as Error)?.message}`);
      return null;
    }
  }

  async history(sessionId?: string): Promise<ChatHistoryTurnDto[]> {
    const session = sessionId ? await this.sessionManager.get(sessionId) : undefined;
    if (!session) return [];
    const turns = await this.messages.getRecentHistory({
      conversationId: session.conversationId,
      userId: session.userId,
      beforeMessageId: '',
      limit: HISTORY_LIMIT,
    });

    await this.attachPendingApproval(session, turns);
    await this.markInFlightTurn(session, turns);

    return turns;
  }

  private async attachPendingApproval(
    session: IChatSession,
    turns: ChatHistoryTurnDto[],
  ): Promise<void> {
    const pending = await this.getPendingApproval(session.conversationId);
    if (!pending) return;

    session.approvalMessageIds.add(pending.messageId);
    if (this.sessionManager.trackApproval) {
      try {
        await this.sessionManager.trackApproval(session.id, pending.messageId);
      } catch {
        // ignore
      }
    }
    if (turns.length > 0) {
      const lastTurn = turns[turns.length - 1];
      if (lastTurn && lastTurn.role === EMessageRole.MODEL) {
        lastTurn.metadata = {
          ...(lastTurn.metadata || {}),
          approval: pending,
        };
      }
    }
  }

  // Chỉ đánh dấu turn cuối còn đang chạy (theo event log) để client biết phải
  // reconnect. Nội dung dở dang KHÔNG được ghép vào history: client lấy nó bằng
  // cách phát lại stream từ đầu (một đường duy nhất, không lệch với stream live).
  private async markInFlightTurn(
    session: IChatSession,
    turns: ChatHistoryTurnDto[],
  ): Promise<void> {
    if (!this.eventLog || turns.length === 0) return;
    const lastTurn = turns[turns.length - 1];
    if (!lastTurn || lastTurn.role !== EMessageRole.MODEL || !lastTurn.id) return;

    try {
      const found = await this.eventLog.getMeta(lastTurn.id);
      const meta = found ? await this.reapIfDead(session, found) : null;
      if (!meta || meta.status !== ETurnLogStatus.ACTIVE) return;
      lastTurn.metadata = {
        ...(lastTurn.metadata || {}),
        inFlight: true,
        status: meta.status,
        messageId: lastTurn.id,
      };
    } catch (err: unknown) {
      this.logger.warn(
        `Không đọc được trạng thái turn ${lastTurn.id} từ event log: ${(err as Error)?.message}`,
      );
    }
  }

  /**
   * Tái kết nối stream của 1 turn: phát lại event log từ đầu rồi bám theo phần đuôi.
   * Turn đã xong mà log còn → phát lại nguyên văn. Log đã hết hạn → trả đáp án cuối
   * từ DB. Không tìm thấy → StreamReconnectInvalidException (400).
   */
  async reconnectStream(
    sessionId: string,
    messageId?: string,
  ): Promise<TurnStream> {
    const session = await this.sessionManager.get(sessionId);
    if (!session) {
      throw new ChatSessionNotFoundException(sessionId);
    }
    if (!this.eventLog) {
      throw new StreamReconnectInvalidException(
        'Tái kết nối stream cần Redis (turn event log) nhưng không khả dụng',
        { sessionId },
      );
    }

    const targetId =
      messageId ?? (await this.eventLog.findActiveTurnId(session.conversationId));
    if (!targetId) {
      throw new StreamReconnectInvalidException(
        'Không có lượt chạy nào đang thực thi để tái kết nối stream',
        { sessionId },
      );
    }

    const found = await this.eventLog.getMeta(targetId);
    const meta = found ? await this.reapIfDead(session, found) : null;
    let turn: ActiveTurn;
    if (meta) {
      if (meta.conversationId && meta.conversationId !== session.conversationId) {
        throw new StreamReconnectInvalidException(
          'Lượt chạy không thuộc phiên làm việc này',
          { sessionId, messageId: targetId },
        );
      }
      turn = this.streamFactory.createReplayTurn(session, targetId);
    } else {
      turn = this.streamFactory.createStaticTurn(
        await this.buildFinishedTurnChunks(session, targetId),
      );
    }

    return {
      sessionId: session.id,
      stream: turn.stream,
      cancel: turn.cancel,
      close: turn.close,
    };
  }

  // Turn ACTIVE mà worker không còn nhịp tim (chết/restart giữa chừng) sẽ không bao
  // giờ tự kết thúc: chốt thành FAILED và lưu phần đã sinh ra xuống DB để user không
  // bị kẹt ở "đang xử lý" mãi mỗi lần reload.
  private async reapIfDead(session: IChatSession, meta: TurnLogMeta): Promise<TurnLogMeta> {
    const log = this.eventLog;
    if (!log || meta.status !== ETurnLogStatus.ACTIVE) return meta;
    if (await log.isAlive(meta.messageId)) return meta;

    this.logger.warn(
      `Turn ${meta.messageId} mất nhịp tim (worker không còn xử lý) — chốt FAILED`,
    );
    const logged = reduceTurnLog(await log.snapshot(meta.messageId));
    const interrupted = 'Tiến trình xử lý bị gián đoạn, vui lòng thử lại.';
    const partial = logged.partialText.trim();
    await this.messages.tryUpdateMessage({
      id: meta.messageId,
      userId: meta.userId ?? session.userId,
      content: partial ? `${partial}\n\n⚠️ *[Đã dừng do sự cố]*: ${interrupted}` : `⚠️ ${interrupted}`,
      ...(logged.steps.length ? { steps: logged.steps } : {}),
      ...(logged.toolCalls.length ? { toolCalls: logged.toolCalls } : {}),
    });
    await log.finish(meta.messageId, ETurnLogStatus.FAILED);
    return { ...meta, status: ETurnLogStatus.FAILED };
  }

  // Log đã hết hạn: dựng lại đáp án cuối từ DB (chỉ trong phạm vi session này).
  private async buildFinishedTurnChunks(
    session: IChatSession,
    messageId: string,
  ): Promise<UIMessageChunk[]> {
    const turns = await this.messages.getRecentHistory({
      conversationId: session.conversationId,
      userId: session.userId,
      beforeMessageId: '',
      limit: HISTORY_LIMIT,
    });
    const turn = turns.find((t) => t.id === messageId && t.role === EMessageRole.MODEL);
    if (!turn) {
      throw new StreamReconnectInvalidException(
        'Không tìm thấy lượt chạy cần tái kết nối stream',
        { sessionId: session.id, messageId },
      );
    }
    return [
      { type: EVercelStreamChunkType.DATA_REPLY, data: { messageId, text: turn.text } } as UIMessageChunk,
      { type: EVercelStreamChunkType.FINISH, finishReason: 'stop' },
    ];
  }

  async listConversations(
    query?: CursorPaginationQueryDto,
  ): Promise<PaginatedResult<IConversationSummary, CursorPageMetaDto>> {
    if (!this.sessionManager.listRecent) {
      return {
        data: [],
        meta: new CursorPageMetaDto(query?.limit ?? 30, undefined, false),
      };
    }
    const result = await this.sessionManager.listRecent({
      cursor: query?.cursor,
      limit: query?.limit,
    });
    return {
      data: result.data,
      meta: new CursorPageMetaDto(result.meta.limit, result.meta.nextCursor, result.meta.hasMore),
    };
  }

  private generateConversationTitle(prompt: string): string {
    const singleLine = prompt.replace(/\s+/g, ' ').trim();
    if (singleLine.length <= 40) return singleLine;
    return `${singleLine.slice(0, 40)}...`;
  }

  private toHttpException(error: unknown): HttpException {
    if (error instanceof HttpException) return error;
    if (error instanceof RpcException) {
      const detail = error.getError() as { code?: string; message?: string };
      const message = detail?.message ?? 'Không duyệt được yêu cầu';
      return this.exceptionFilter.toHttpException(detail, message);
    }
    this.logger.error(`approve failed: ${(error as Error)?.message}`);
    return new InternalServerErrorException((error as Error)?.message);
  }
}
