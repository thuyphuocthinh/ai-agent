import { randomUUID } from 'crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import type { UIMessageChunk } from 'ai';
import {
  EApprovalAction,
  EMessageRole,
  ORCHESTRATION_ERROR,
} from '@agent/core/constants';
import {
  EJobName,
  IProcessAiTriggerJobData,
} from '@agent/core/infrastructure/queue';
import { AiOrchestrationProcessor } from '../engine/orchestrator/ai-orchestration.processor';
import { ApprovalRequestService } from '../engine/hitl/approval-request.service';
import { AgentCancellationService } from '../engine/cancellation/agent-cancellation.service';
import { AgentStreamService } from '../contracts/agent-stream.service';
import {
  MessageClientService,
  MessageEvent,
} from '../contracts/message-client.service';
import { ChatHistoryTurnDto } from '../contracts/dtos/message-client.dto';
import { VercelUiStreamAdapter } from '../contracts/vercel-ui-stream.adapter';

// processor.process nhận Job của BullMQ; chỉ cần `name` và `data`.
type ProcessJob = Parameters<AiOrchestrationProcessor['process']>[0];

export const TURN_TIMEOUT_MS = 5 * 60 * 1000;
const HISTORY_LIMIT = 200;

interface Session {
  id: string;
  // Các cột Postgres liên quan là uuid nên mọi id của phiên đều là UUID.
  userId: string;
  conversationId: string;
  tenantId: string;
  botUserId: string;
  // Id các message yêu cầu duyệt đã phát ra trong phiên.
  approvalMessageIds: Set<string>;
}

export interface TurnStream {
  sessionId: string;
  stream: ReadableStream<UIMessageChunk>;
  /** Client ngắt kết nối giữa chừng: huỷ turn và dọn listener. */
  cancel: () => Promise<void>;
}

@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);
  private readonly sessions = new Map<string, Session>();

  constructor(
    private readonly processor: AiOrchestrationProcessor,
    private readonly messages: MessageClientService,
    private readonly agentStream: AgentStreamService,
    private readonly approvals: ApprovalRequestService,
    private readonly cancellation: AgentCancellationService,
  ) {}

  async chat(prompt: string, sessionId?: string): Promise<TurnStream> {
    const session = this.sessionFor(sessionId);
    const turn = this.openTurn(session);
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
    // Chạy nền: stream trả về ngay, engine đẩy dữ liệu vào dần.
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
    const session = this.sessions.get(sessionId);
    if (!session) throw new NotFoundException('Phiên không tồn tại');
    if (!session.approvalMessageIds.has(messageId)) {
      throw new NotFoundException('Không có yêu cầu duyệt này trong phiên');
    }

    // Gắn stream TRƯỚC khi duyệt để không lỡ event; lượt chạy tiếp phát event theo id message duyệt.
    const turn = this.openTurn(session, messageId);
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
    const session = sessionId ? this.sessions.get(sessionId) : undefined;
    if (!session) return [];
    return this.messages.getRecentHistory({
      conversationId: session.conversationId,
      userId: session.userId,
      beforeMessageId: '',
      limit: HISTORY_LIMIT,
    });
  }

  private sessionFor(sessionId?: string): Session {
    const existing = sessionId ? this.sessions.get(sessionId) : undefined;
    if (existing) return existing;
    const session: Session = {
      id: randomUUID(),
      userId: randomUUID(),
      conversationId: randomUUID(),
      tenantId: randomUUID(),
      botUserId: randomUUID(),
      approvalMessageIds: new Set(),
    };
    this.sessions.set(session.id, session);
    return session;
  }

  /** Dựng stream cho 1 lượt chạy: adapter (event của engine) + observer message (câu trả lời cuối, lỗi, yêu cầu duyệt). */
  private openTurn(session: Session, boundMessageId?: string) {
    let controller!: ReadableStreamDefaultController<UIMessageChunk>;
    let closed = false;
    const cleanups: Array<() => void> = [];

    const release = () => {
      closed = true;
      cleanups.splice(0).forEach((fn) => fn());
    };
    const close = () => {
      if (closed) return;
      release();
      try {
        controller.close();
      } catch {
        // stream đã đóng
      }
    };

    const adapter = new VercelUiStreamAdapter({
      messageId: boundMessageId,
      write: (chunk) => {
        if (closed) return;
        controller.enqueue(chunk);
        if (chunk.type === 'finish') close();
      },
    });
    const stream = new ReadableStream<UIMessageChunk>({
      start: (c) => {
        controller = c;
      },
      cancel: () => release(),
    });

    cleanups.push(adapter.attach(this.agentStream));
    cleanups.push(
      this.messages.onMessage((event) => this.handleMessage(event, session, adapter)),
    );

    const fail = async (error: unknown) => {
      if (closed) return;
      await adapter.flush();
      if (closed) return;
      if (!adapter.finished) {
        controller.enqueue({
          type: 'error',
          errorText: String((error as Error)?.message ?? error),
        });
        controller.enqueue({ type: 'finish', finishReason: 'error' });
      }
      close();
    };

    const timer = setTimeout(
      () => void fail(new Error('Quá thời gian chờ phản hồi của engine')),
      TURN_TIMEOUT_MS,
    );
    timer.unref?.();
    cleanups.push(() => clearTimeout(timer));

    const cancel = async () => {
      if (closed) return;
      const replyId = adapter.boundMessageId;
      const alreadyFinished = adapter.finished;
      close();
      if (replyId && !alreadyFinished) {
        await this.cancellation.requestCancel(replyId).catch(() => undefined);
      }
    };

    return { stream, close, fail, cancel };
  }

  private handleMessage(
    event: MessageEvent,
    session: Session,
    adapter: VercelUiStreamAdapter,
  ): void {
    if (
      event.conversationId !== session.conversationId ||
      event.role !== EMessageRole.MODEL
    ) {
      return;
    }

    if (event.type === 'created') {
      if (typeof event.content === 'object' && event.content.type === 'approval_request') {
        session.approvalMessageIds.add(event.id);
        adapter.send({
          type: 'data-approval',
          data: {
            messageId: event.id,
            tool: event.content.tool,
            preview: event.content.preview,
            friendlySummary: (event.content as Record<string, unknown>).friendlySummary,
          },
        });
        return;
      }
      // Message đầu tiên engine tạo cho turn là reply: từ đây mới biết id để lọc event.
      adapter.bind(event.id);
      return;
    }

    // Câu trả lời cuối và lỗi của engine chỉ đi qua updateMessage, không đi qua stream.
    if (event.id === adapter.boundMessageId && typeof event.content === 'string') {
      adapter.send({
        type: 'data-reply',
        data: { messageId: event.id, text: event.content },
      });
    }
  }

  private toHttpException(error: unknown): HttpException {
    if (error instanceof HttpException) return error;
    if (error instanceof RpcException) {
      const detail = error.getError() as { code?: string; message?: string };
      const message = detail?.message ?? 'Không duyệt được yêu cầu';
      switch (detail?.code) {
        case ORCHESTRATION_ERROR.CHECKPOINT_NOT_FOUND.code:
          return new NotFoundException(message);
        case ORCHESTRATION_ERROR.CHECKPOINT_FORBIDDEN.code:
          return new ForbiddenException(message);
        case ORCHESTRATION_ERROR.CHECKPOINT_ALREADY_RESOLVED.code:
          return new ConflictException(message);
        case ORCHESTRATION_ERROR.CHECKPOINT_ACTION_MISMATCH.code:
          return new BadRequestException(message);
      }
    }
    this.logger.error(`approve failed: ${(error as Error)?.message}`);
    return new InternalServerErrorException((error as Error)?.message);
  }
}
