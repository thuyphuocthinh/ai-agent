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
import { EApprovalAction } from '@agent/core/constants';
import {
  EJobName,
  EQueueName,
  IProcessAiTriggerJobData,
  IQueueDispatcher,
  QUEUE_DISPATCHER,
} from '@agent/core/infrastructure/queue';
import { ApprovalRequestService } from '../../engine/hitl/approval-request.service';
import {
  CHAT_SESSION_MANAGER,
  IChatSessionManager,
  IMessageSink,
  MESSAGE_SINK,
  TurnStream,
  EConversationState,
  IConversationSummary,
} from '../../contracts';
import { ChatHistoryTurnDto } from '../../contracts/dtos/message-client.dto';
import {
  CursorPaginationQueryDto,
  CursorPageMetaDto,
  PaginatedResult,
} from '../presentation/dtos/pagination.dto';
import { TurnStreamFactory } from './turn-stream.factory';
import { OrchestrationRpcExceptionFilter } from '../presentation/filters/orchestration-exception.filter';
import {
  PromptInjectionGuard,
  SemanticPolicyEvaluatorService,
  HumanEscalationService,
  BusinessPolicyViolationError,
  EPolicyVerdict,
} from '../../security';

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
      return { sessionId: session.id, stream: turn.stream, cancel: turn.cancel };
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

    return { sessionId: session.id, stream: turn.stream, cancel: turn.cancel };
  }

  async approve(
    sessionId: string,
    messageId: string,
    action: 'approve' | 'reject',
  ): Promise<TurnStream> {
    const session = await this.sessionManager.get(sessionId);
    if (!session) throw new NotFoundException('Phiên không tồn tại');

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
      throw new NotFoundException('Không có yêu cầu duyệt này trong phiên');
    }

    const turn = this.streamFactory.createTurn(session, messageId);
    try {
      await this.approvals.resolveApproval({
        userId: session.userId,
        messageId,
        action: action as EApprovalAction,
      });
    } catch (error) {
      turn.close();
      throw this.toHttpException(error);
    }
    return { sessionId: session.id, stream: turn.stream, cancel: turn.cancel };
  }

  async history(sessionId?: string): Promise<ChatHistoryTurnDto[]> {
    const session = sessionId ? await this.sessionManager.get(sessionId) : undefined;
    if (!session) return [];
    return this.messages.getRecentHistory({
      conversationId: session.conversationId,
      userId: session.userId,
      beforeMessageId: '',
      limit: HISTORY_LIMIT,
    });
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
