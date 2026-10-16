import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ESocketEvent, EStepExecutionStatus } from '@agent/core/constants';
import { EJobName, EQueueName, QueueService } from '@agent/core/infrastructure/queue';
import {
  AgentStreamContext,
  AgentStreamStep,
  DEFAULT_STREAM_KEY,
  IStreamSink,
} from '../contracts';

export type { AgentStreamContext, AgentStreamStep, IStreamSink };
export { DEFAULT_STREAM_KEY };

// Log thật (session 2026-07-20): 1 câu trả lời dài (~vài trăm từ) sinh ra HÀNG
// TRĂM job Redis riêng lẻ trong vài giây — mỗi chunk SSE từ provider (thường
// chỉ vài ký tự, xem OpenAiStrategy.sendMessage() `onToken(delta.content)`)
// đẩy thẳng 1 job BullMQ riêng (Redis write + worker pickup + socket emit).
// Không sai logic (không mất dữ liệu, không lặp vô hạn) nhưng KHÔNG chịu được
// tải nhiều turn đồng thời — gộp nhiều token chunk liên tiếp (cùng messageId +
// streamKey) thành 1 job duy nhất, xả theo thời gian, giảm số job hàng chục lần
// mà FE vẫn nhận đúng thứ tự (FE chỉ nối `text` lại, chunk to/nhỏ không đổi kết
// quả cuối). Step KHÔNG PHẢI 'token' (tool_call/tool_result/resync/done) luôn
// xả hết token đang gộp dở TRƯỚC rồi mới emit chính nó — giữ đúng thứ tự event.
const TOKEN_BATCH_FLUSH_MS = 75;

// SocketProcessor (app socket-gateway, KHÁC process với orchestration) xử lý
// SOCKET_QUEUE với concurrency=20 — nhiều job CÙNG 1 stream vẫn có thể bị BullMQ
// xử lý không đúng thứ tự nếu rơi vào các worker slot khác nhau cùng lúc. Đánh
// số `seq` TĂNG DẦN theo đúng thứ tự emitStep() được GỌI (không phải thứ tự job
// tới nơi xử lý) — SocketProcessor dùng số này để tự sắp lại đúng thứ tự trước
// khi emit ra socket thật, không cần FE đổi gì.
interface StreamSequenceState {
  next: number;
  lastActivity: number;
}

// Dọn state của các stream đã lâu không hoạt động (turn xong từ lâu, hoặc
// streamKey riêng của 1 round chỉ dùng đúng 1 lần rồi không bao giờ dùng lại —
// xem delegateRound()) — tránh Map phình vô hạn qua thời gian uptime dài.
const SEQUENCE_SWEEP_INTERVAL_MS = 5 * 60 * 1000;
const SEQUENCE_STALE_MS = 10 * 60 * 1000;

interface PendingTokenBatch {
  text: string;
  context: AgentStreamContext;
  timer: NodeJS.Timeout;
}

interface EmitPayload {
  event: string;
  room: string;
  data: Record<string, unknown>;
}

/**
 * Tách riêng khỏi ReactLoopService — "done" (kết thúc turn) giờ do tầng
 * orchestrator ngoài cùng (AiOrchestrationProcessor) phát ra, bao trùm cả
 * nhánh Supervisor tự trả lời lẫn nhánh delegate; "tool_call"/"tool_result"
 * vẫn do ReactLoopService phát vì chỉ nó biết chi tiết từng bước tool. Gộp
 * logic build room vào 1 chỗ duy nhất — thêm step type mới (Giai đoạn 3
 * HITL sẽ cần) không phải sửa nhiều nơi.
 */
@Injectable()
export class AgentStreamService implements IStreamSink, OnModuleDestroy {
  private readonly logger = new Logger(AgentStreamService.name);
  // Khoá theo `${messageId}:${streamKey}` — cô lập đúng 1 luồng text (xem
  // AgentStreamContext.streamKey), khớp cách FE tách nội dung theo streamKey.
  private readonly pendingTokenBatches = new Map<string, PendingTokenBatch>();
  private readonly sequenceStates = new Map<string, StreamSequenceState>();
  private readonly sweepTimer: NodeJS.Timeout;

  constructor(private readonly queueService: QueueService) {
    this.sweepTimer = setInterval(
      () => this.sweepStaleSequenceStates(),
      SEQUENCE_SWEEP_INTERVAL_MS,
    );
    this.sweepTimer.unref?.();
  }

  /**
   * Luôn chỉ emit vào room riêng của người trigger (`user_<userId>`) —
   * không broadcast vào room channel/group.
   */
  async emitStep(
    context: AgentStreamContext,
    step: AgentStreamStep,
  ): Promise<void> {
    const key = this.batchKey(context);

    if (step.type === 'token') {
      this.bufferToken(key, context, step.text ?? '');
      return;
    }

    // seq gán ĐỒNG BỘ ở đây (trước khi addJob() bất đồng bộ) — nếu không, 1 caller
    // không await emitStep() có thể bị 1 lệnh gọi SAU nhưng có await giành seq trước.
    const pending = this.drainPendingBatch(key);
    const payload = this.buildEmitPayload(context, step, key);
    if (pending) await this.sendPayload(pending);
    await this.sendPayload(payload);
  }

  async emitToken(context: AgentStreamContext, token: string): Promise<void> {
    await this.emitStep(context, { type: 'token', text: token });
  }

  async flush(): Promise<void> {
    const payloads = [...this.pendingTokenBatches.keys()]
      .map((key) => this.drainPendingBatch(key))
      .filter((p): p is EmitPayload => p !== null);
    await Promise.all(payloads.map((p) => this.sendPayload(p)));
  }

  async onModuleDestroy(): Promise<void> {
    clearInterval(this.sweepTimer);
    await this.flush();
  }

  private batchKey(context: AgentStreamContext): string {
    return `${context.messageId}:${context.streamKey ?? DEFAULT_STREAM_KEY}`;
  }

  private bufferToken(
    key: string,
    context: AgentStreamContext,
    text: string,
  ): void {
    const existing = this.pendingTokenBatches.get(key);
    if (existing) {
      existing.text += text;
      return;
    }
    const timer = setTimeout(() => {
      const payload = this.drainPendingBatch(key);
      if (payload) {
        this.sendPayload(payload).catch((error) =>
          this.logger.error(
            `flush() failed for ${key}: ${(error as Error).message}`,
          ),
        );
      }
    }, TOKEN_BATCH_FLUSH_MS);
    this.pendingTokenBatches.set(key, { text, context, timer });
  }

  private drainPendingBatch(key: string): EmitPayload | null {
    const batch = this.pendingTokenBatches.get(key);
    if (!batch) return null;
    clearTimeout(batch.timer);
    this.pendingTokenBatches.delete(key);
    return this.buildEmitPayload(
      batch.context,
      { type: 'token', text: batch.text },
      key,
    );
  }

  private nextSeq(key: string): number {
    const state = this.sequenceStates.get(key) ?? { next: 1, lastActivity: 0 };
    const seq = state.next;
    state.next += 1;
    state.lastActivity = Date.now();
    this.sequenceStates.set(key, state);
    return seq;
  }

  private sweepStaleSequenceStates(): void {
    const now = Date.now();
    for (const [key, state] of this.sequenceStates) {
      if (now - state.lastActivity > SEQUENCE_STALE_MS) {
        this.sequenceStates.delete(key);
      }
    }
  }

  private buildEmitPayload(
    context: AgentStreamContext,
    step: AgentStreamStep,
    key: string,
  ): EmitPayload {
    const seq = this.nextSeq(key);
    if (step.type === 'done') {
      this.sequenceStates.delete(key);
    }
    return {
      event: ESocketEvent.AGENT_STREAM,
      room: `user_${context.userId}`,
      data: {
        ...step,
        channelId: context.channelId,
        messageId: context.messageId,
        streamKey: context.streamKey ?? DEFAULT_STREAM_KEY,
        seq,
      },
    };
  }

  private async sendPayload(payload: EmitPayload): Promise<void> {
    await this.queueService.addJob(
      EQueueName.SOCKET_QUEUE,
      EJobName.EMIT_EVENT,
      payload,
    );
  }
}
