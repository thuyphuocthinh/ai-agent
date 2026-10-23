import {
  HttpException,
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import type { UIMessageChunk } from 'ai';
import { EApprovalAction } from '@agent/core/constants';
import {
  EJobName,
  IProcessAiTriggerJobData,
} from '@agent/core/infrastructure/queue';
import { AiOrchestrationProcessor } from '../../engine/orchestrator/ai-orchestration.processor';
import { ApprovalRequestService } from '../../engine/hitl/approval-request.service';
import { IMessageSink, MESSAGE_SINK } from '../../contracts';
import { ChatHistoryTurnDto } from '../../contracts/dtos/message-client.dto';
import { ChatSessionManager } from './chat-session.manager';
import { TurnStreamFactory } from './turn-stream.factory';
import { OrchestrationRpcExceptionFilter } from '../presentation/filters/orchestration-exception.filter';

type ProcessJob = Parameters<AiOrchestrationProcessor['process']>[0];
const HISTORY_LIMIT = 200;

export interface TurnStream {
  sessionId: string;
  stream: ReadableStream<UIMessageChunk>;
  cancel: () => Promise<void>;
}

@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);
  private readonly exceptionFilter = new OrchestrationRpcExceptionFilter();

  constructor(
    private readonly sessionManager: ChatSessionManager,
    private readonly streamFactory: TurnStreamFactory,
    private readonly processor: AiOrchestrationProcessor,
    @Inject(MESSAGE_SINK)
    private readonly messages: IMessageSink,
    private readonly approvals: ApprovalRequestService,
  ) {}

  async chat(prompt: string, sessionId?: string): Promise<TurnStream> {
    const session = this.sessionManager.getOrCreate(sessionId);
    const turn = this.streamFactory.createTurn(session);
    const userMessage = await this.messages.addUserMessage({
      conversationId: session.conversationId,
      text: prompt,
    });

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
    };

    void this.processor
      .process({ name: EJobName.PROCESS_AI_TRIGGER, data } as unknown as ProcessJob)
      .catch((error) => {
        this.logger.error(`Turn failed: ${error?.message}`);
        return turn.fail(error);
      });

    return { sessionId: session.id, stream: turn.stream, cancel: turn.cancel };
  }

  async approve(
    sessionId: string,
    messageId: string,
    action: 'approve' | 'reject',
  ): Promise<TurnStream> {
    const session = this.sessionManager.get(sessionId);
    if (!session) throw new NotFoundException('Phiên không tồn tại');
    if (!session.approvalMessageIds.has(messageId)) {
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
    const session = sessionId ? this.sessionManager.get(sessionId) : undefined;
    if (!session) return [];
    return this.messages.getRecentHistory({
      conversationId: session.conversationId,
      userId: session.userId,
      beforeMessageId: '',
      limit: HISTORY_LIMIT,
    });
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
