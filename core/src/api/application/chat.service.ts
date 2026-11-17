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
  ChatInputOptions,
  IMAGE_OCR_SERVICE,
  IImageOcrService,
  IMessageAttachment,
} from '../../contracts';
import { reduceTurnLog } from '../../contracts/streaming/turn-log-reducer';
import { ChatHistoryTurnDto } from '../../contracts/dtos/message-client.dto';
import {
  CursorPaginationQueryDto,
  CursorPageMetaDto,
  PaginatedResult,
} from '../../contracts/dtos/pagination.dto';
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
import { ImagePromptEnricherUtil } from '../../common/text/image-prompt-enricher.util';
import { IChatSession } from '../../contracts/session/chat-session.interface';

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
    @Optional()
    @Inject(IMAGE_OCR_SERVICE)
    private readonly ocrService?: IImageOcrService,
  ) {}

  /**
   * Khởi tạo lượt chat và kích hoạt quy trình điều phối AI.
   * Hỗ trợ nhận ChatInputOptions (chuẩn Clean Code) hoặc (prompt, sessionId, workflowId) (tương thích ngược).
   */
  async chat(
    input: string | ChatInputOptions,
    sessionId?: string,
    workflowId?: string,
  ): Promise<TurnStream> {
    const options = this.normalizeChatOptions(input, sessionId, workflowId);
    const session = await this.sessionManager.getOrCreate(options.sessionId);

    // 1. OCR bóc tách và ghép prompt nếu có hình ảnh đính kèm
    const effectivePrompt = await this.resolvePromptWithOcr(options, session.id);

    // 2. Layer 2 Security Guardrail: Quét cả Prompt và văn bản từ ảnh chống Visual Prompt Injection
    const safePrompt = this.assertSafePrompt(effectivePrompt);
    const safeUserPrompt = this.assertSafePrompt(options.prompt);

    // 3. Cập nhật tiêu đề hội thoại nếu là phiên mới (chạy nền, không chặn luồng)
    this.triggerTitleUpdate(session, options.prompt);

    // 4. Lưu User Message vào Message Sink (chỉ lưu prompt gốc sạch + attachments)
    const attachments = this.resolveAttachments(options);
    const userMessage = await this.messages.addUserMessage({
      conversationId: session.conversationId,
      text: safeUserPrompt,
      attachments,
    });

    // 5. Kiểm tra trạng thái HUMAN_TAKEOVER
    if (await this.isSessionMuted(session)) {
      return this.createMutedTurn(session);
    }

    // 6. Khởi tạo Turn Stream và đẩy Job vào BullMQ (kèm prompt enriched và dynamic channelType/sessionType)
    const turn = this.streamFactory.createTurn(session);
    this.dispatchTurnQueueJob(session, userMessage.id, options, turn, safePrompt);

    return { sessionId: session.id, stream: turn.stream, cancel: turn.cancel, close: turn.close };
  }

  /**
   * Chuẩn hóa tham số đầu vào hỗ trợ cả DTO object và legacy positional arguments.
   */
  private normalizeChatOptions(
    input: string | ChatInputOptions,
    sessionId?: string,
    workflowId?: string,
  ): ChatInputOptions {
    if (typeof input === 'string') {
      return { prompt: input, sessionId, workflowId };
    }
    return input;
  }

  /**
   * Xử lý OCR và ghép prompt nếu người dùng gửi kèm ảnh.
   */
  private async resolvePromptWithOcr(
    options: ChatInputOptions,
    turnId: string,
  ): Promise<string> {
    const { imageUrl, imageBase64, prompt } = options;
    if ((!imageUrl && !imageBase64) || !this.ocrService) {
      return prompt;
    }

    try {
      const ocrResult = await this.ocrService.extractText({
        imageUrl,
        imageBase64,
        turnId,
      });
      return ImagePromptEnricherUtil.enrich({ ocrResult, userPrompt: prompt });
    } catch (err) {
      this.logger.warn(
        `OCR bóc tách ảnh thất bại: ${(err as Error).message}. Tiếp tục xử lý với prompt gốc.`,
      );
      return prompt;
    }
  }

  /**
   * Kiểm tra an ninh qua PromptInjectionGuard nếu đã đăng ký.
   */
  private assertSafePrompt(prompt: string): string {
    if (!this.injectionGuard) {
      return prompt;
    }
    return this.injectionGuard.assertSafe(prompt);
  }

  /**
   * Cập nhật tiêu đề phiên làm việc nếu là tiêu đề mặc định.
   */
  private triggerTitleUpdate(session: IChatSession, originalPrompt: string): void {
    if (session.title && session.title !== 'Cuộc trò chuyện mới') {
      return;
    }
    const generatedTitle = this.generateConversationTitle(originalPrompt);
    if (this.sessionManager.updateTitle) {
      void this.sessionManager.updateTitle(session.id, generatedTitle).catch((err) => {
        this.logger.warn(`Không thể cập nhật tiêu đề cuộc trò chuyện: ${(err as Error)?.message}`);
      });
    }
  }

  /**
   * Kiểm tra xem phiên có đang trong trạng thái tắt tiếng AI (Human Takeover) không.
   */
  private async isSessionMuted(session: IChatSession): Promise<boolean> {
    const state =
      (await this.sessionManager.getConversationState?.(session.id)) ??
      session.state;
    return state === EConversationState.HUMAN_TAKEOVER;
  }

  /**
   * Tạo turn rỗng khi AI đang bị tắt tiếng để nhân viên hỗ trợ trực tiếp.
   */
  private createMutedTurn(session: IChatSession): TurnStream {
    this.logger.log(
      `Session ${session.id} is in HUMAN_TAKEOVER state. AI Mute active - skipping AI orchestration.`,
    );
    const turn = this.streamFactory.createTurn(session);
    turn.close();
    return { sessionId: session.id, stream: turn.stream, cancel: turn.cancel, close: turn.close };
  }

  /**
   * Bóc tách thông tin file đính kèm từ ChatInputOptions.
   */
  private resolveAttachments(options: ChatInputOptions): IMessageAttachment[] | undefined {
    if (options.imageUrl) {
      return [{ type: 'image', url: options.imageUrl }];
    }
    if (options.imageBase64) {
      const url = options.imageBase64.startsWith('data:')
        ? options.imageBase64
        : `data:image/png;base64,${options.imageBase64}`;
      return [{ type: 'image', url }];
    }
    return undefined;
  }

  /**
   * Đóng gói payload và gửi lượt chạy sang hàng đợi BullMQ.
   * sessionType và channelType được phân giải động:
   * 1. Ưu tiên giá trị truyền trong ChatInputOptions (API/webhook request).
   * 2. Kế đến lấy từ IChatSession (cột channel_type trong Database Conversation).
   * 3. Fallback mặc định 'web' nếu cả hai đều không cung cấp.
   */
  private dispatchTurnQueueJob(
    session: IChatSession,
    messageId: string,
    options: ChatInputOptions,
    turn: ActiveTurn,
    prompt?: string,
  ): void {
    const channelType = options.channelType ?? session.channelType ?? 'web';
    const sessionType = options.sessionType ?? session.sessionType ?? channelType;

    const data: IProcessAiTriggerJobData = {
      userId: session.userId,
      channelId: session.conversationId,
      conversationId: session.conversationId,
      workspaceId: session.tenantId,
      tenantId: session.tenantId,
      messageId,
      botUserId: session.botUserId,
      sessionType,
      channelType,
      workflowId: options.workflowId,
      prompt,
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
