import { Logger } from '@nestjs/common';
// `import type` bị xoá lúc biên dịch: adapter không kéo runtime ESM của `ai`
// vào core, chỉ mượn hợp đồng UIMessageChunk của v7.
import type { UIMessageChunk } from 'ai';
import {
  EAgentStreamStepType,
  EAgentStreamStepKind,
  EVercelStreamChunkType,
  STREAM_KEYS,
} from '@agent/core/constants';
import {
  AgentStreamContext,
  AgentStreamStep,
  DEFAULT_STREAM_KEY,
} from './stream-sink.interface';
import {
  AgentStepSource,
  UiChunkWriter,
  VercelUiStreamOptions,
} from './vercel-stream.interface';

const EMPTY_TOOL_INPUT = {};

// argsPreview là chuỗi để hiển thị: JSON của object (đã stringify), hoặc
// code/SQL/chuỗi đơn nguyên văn. Chỉ object mới dùng được làm `input`.
function toToolInput(argsPreview?: string): unknown {
  if (!argsPreview) return EMPTY_TOOL_INPUT;
  try {
    const parsed: unknown = JSON.parse(argsPreview);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed;
    }
  } catch {
    // không phải JSON — rơi xuống nhánh bọc bên dưới
  }
  return { preview: argsPreview };
}

/**
 * Adapter Layer 1: đổi AgentStreamStep của 1 turn thành UI Message Stream của
 * Vercel AI SDK v7 (`useChat` đọc được). Engine không biết adapter này tồn tại —
 * nó chỉ nghe qua AgentStreamService.onStep, nên các sink khác (CLI, DB) vẫn
 * nhận nguyên vẹn mọi event.
 *
 * Luôn giữ stream đúng cấu trúc: text được đóng trước tool/step/finish, mỗi
 * tool-output có tool-input đi trước, và `finish` chỉ phát một lần.
 *
 * Dùng cho HIỂN THỊ: argsPreview/resultPreview là bản xem trước, không dùng để
 * chạy lại tool.
 */
export class VercelUiStreamAdapter {
  private readonly logger = new Logger(VercelUiStreamAdapter.name);
  private messageId?: string;
  private readonly write: UiChunkWriter;

  private writeChain: Promise<void> = Promise.resolve();
  private detachListener?: () => void;
  private broken = false;
  private started = false;
  private stepOpen = false;
  private currentStepKind?: EAgentStreamStepKind | `${EAgentStreamStepKind}`;
  private finishedFlag = false;
  private partCounter = 0;
  private fallbackCallCounter = 0;

  // Text part đang mở theo streamKey (các agent chạy song song có streamKey riêng).
  private readonly openTextParts = new Map<string, string>();
  // Phản chiếu `confirmedText` của ReactLoop theo streamKey, để biết resync()
  // có thật sự sửa nội dung đã stream hay không.
  private readonly confirmedText = new Map<string, string>();
  private readonly announcedToolCalls = new Set<string>();
  // Ghép call/result theo tên tool khi producer cũ không gửi toolCallId.
  private readonly pendingIdsByTool = new Map<string, string[]>();

  constructor(options: VercelUiStreamOptions) {
    this.messageId = options.messageId;
    this.write = options.write;
  }

  get finished(): boolean {
    return this.finishedFlag;
  }

  /** messageId đang theo dõi (undefined nếu chưa bind). */
  get boundMessageId(): string | undefined {
    return this.messageId;
  }

  /** Gán messageId khi nó chỉ biết sau lúc tạo adapter; chỉ lần đầu có tác dụng. */
  bind(messageId: string): void {
    if (this.messageId === undefined) {
      this.messageId = messageId;
    }
  }

  /**
   * Chèn 1 chunk tuỳ biến (VD `data-reply`, `data-approval`) vào ĐÚNG hàng đợi
   * ghi của stream nên giữ được thứ tự với các chunk của engine. Bỏ qua nếu chưa
   * bind hoặc stream đã kết thúc.
   */
  send(chunk: UIMessageChunk): void {
    if (this.messageId === undefined || this.finishedFlag || this.broken) return;
    this.ensureStarted();
    this.emit(chunk);
  }

  /** Đăng ký vào nguồn event; trả hàm huỷ đăng ký (cũng tự gọi khi turn kết thúc). */
  attach(source: AgentStepSource): () => void {
    this.detachListener?.();
    const unsubscribe = source.onStep((context, step) =>
      this.handle(context, step),
    );
    const detach = () => {
      unsubscribe();
      if (this.detachListener === detach) this.detachListener = undefined;
    };
    this.detachListener = detach;
    return detach;
  }

  /** Chờ mọi chunk đã xếp hàng được ghi xong (dùng trước khi đóng response). */
  flush(): Promise<void> {
    return this.writeChain;
  }

  handle(context: AgentStreamContext, step: AgentStreamStep): void {
    if (this.finishedFlag || this.broken) return;
    if (this.messageId === undefined || context.messageId !== this.messageId) return;

    const streamKey = context.streamKey ?? STREAM_KEYS.DEFAULT;
    switch (step.type) {
      case EAgentStreamStepType.STEP_START:
        return this.onStepStart(streamKey, step);
      case EAgentStreamStepType.TOKEN:
        return this.onToken(streamKey, step.text ?? '');
      case EAgentStreamStepType.RESYNC:
        return this.onResync(streamKey, step.text ?? '');
      case EAgentStreamStepType.TOOL_CALL:
        return this.onToolCall(streamKey, step);
      case EAgentStreamStepType.TOOL_RESULT:
        return this.onToolResult(streamKey, step);
      case EAgentStreamStepType.DONE:
        return this.onDone();
    }
  }

  private onStepStart(streamKey: string, step: AgentStreamStep): void {
    const nextKind = step.kind ?? EAgentStreamStepKind.EXECUTION;

    if (this.openTextParts.has(streamKey)) {
      this.closeText(streamKey);
    }

    if (this.currentStepKind && this.currentStepKind !== nextKind) {
      this.closeStep();
    }

    this.currentStepKind = nextKind;
    this.openStep();

    if (step.persona) {
      this.emit({ type: EVercelStreamChunkType.DATA_PERSONA, id: streamKey, data: step.persona });
    }
    if (step.label) {
      this.emit({
        type: EVercelStreamChunkType.DATA_STATUS,
        id: streamKey,
        data: { label: step.label, kind: step.kind },
      });
    }
  }

  private onToken(streamKey: string, text: string): void {
    if (!text) return;
    this.openStep();
    this.confirmedText.set(
      streamKey,
      (this.confirmedText.get(streamKey) ?? '') + text,
    );

    let id = this.openTextParts.get(streamKey);
    if (!id) {
      id =
        streamKey !== STREAM_KEYS.DEFAULT
          ? `${streamKey}__text-${++this.partCounter}`
          : `text-${++this.partCounter}`;
      this.openTextParts.set(streamKey, id);
      this.emit({ type: EVercelStreamChunkType.TEXT_START, id });
    }
    this.emit({ type: EVercelStreamChunkType.TEXT_DELTA, id, delta: text });
  }

  // Stream chỉ nối thêm (append-only), không thu hồi được text đã gửi. Khi
  // engine sửa lại nội dung (VD bỏ phần self-check bị revert) ta đóng text part
  // hiện tại và báo nội dung chuẩn bằng data-resync để UI nào quan tâm thì thay.
  private onResync(streamKey: string, text: string): void {
    const streamed = this.confirmedText.get(streamKey) ?? '';
    this.closeText(streamKey);
    if (text && text !== streamed) {
      this.openStep();
      this.emit({ type: EVercelStreamChunkType.DATA_RESYNC, id: streamKey, data: { text } });
    }
    this.confirmedText.set(streamKey, text);
  }

  private onToolCall(streamKey: string, step: AgentStreamStep): void {
    this.openStep();
    this.closeText(streamKey);

    const toolName = step.tool ?? 'unknown';
    const toolCallId = step.toolCallId ?? this.registerFallbackId(toolName);
    if (this.announcedToolCalls.has(toolCallId)) return;

    this.announceToolCall(
      toolCallId,
      toolName,
      toToolInput(step.argsPreview),
      step.friendlySummary,
      streamKey,
    );
  }

  private onToolResult(streamKey: string, step: AgentStreamStep): void {
    this.openStep();
    this.closeText(streamKey);

    const toolName = step.tool ?? 'unknown';
    const toolCallId =
      step.toolCallId ??
      this.pendingIdsByTool.get(toolName)?.shift() ??
      this.nextFallbackId();

    // Kết quả mồ côi (VD tool bị chặn vì lặp quá nhiều lần, chưa từng phát
    // tool_call) vẫn cần 1 tool-input đi trước để part hợp lệ.
    if (!this.announcedToolCalls.has(toolCallId)) {
      this.announceToolCall(toolCallId, toolName, EMPTY_TOOL_INPUT, undefined, streamKey);
    }

    if (step.status === 'error') {
      this.emit({
        type: EVercelStreamChunkType.TOOL_OUTPUT_ERROR,
        toolCallId,
        errorText: step.resultPreview || 'Tool execution failed',
        dynamic: true,
      });
      return;
    }
    this.emit({
      type: EVercelStreamChunkType.TOOL_OUTPUT_AVAILABLE,
      toolCallId,
      output: step.resultPreview ?? '',
      dynamic: true,
    });
  }

  private onDone(): void {
    this.closeStep();
    this.ensureStarted();
    this.emit({ type: EVercelStreamChunkType.FINISH, finishReason: 'stop' });
    this.finishedFlag = true;
    this.detachListener?.();
  }

  private announceToolCall(
    toolCallId: string,
    toolName: string,
    input: unknown,
    friendlySummary?: string,
    streamKey?: string,
  ): void {
    this.announcedToolCalls.add(toolCallId);

    const hasCustomStream = Boolean(
      streamKey && streamKey !== STREAM_KEYS.DEFAULT,
    );
    let title: string | undefined;
    let toolMetadata: Record<string, string> | undefined;

    if (friendlySummary) {
      title = friendlySummary;
      toolMetadata = { friendlySummary };
      if (hasCustomStream && streamKey) {
        toolMetadata.streamKey = streamKey;
      }
    } else if (hasCustomStream && streamKey) {
      toolMetadata = { streamKey };
    }

    this.emit({
      type: EVercelStreamChunkType.TOOL_INPUT_AVAILABLE,
      toolCallId,
      toolName,
      input,
      dynamic: true,
      ...(title ? { title } : {}),
      ...(toolMetadata ? { toolMetadata } : {}),
    });
  }

  private nextFallbackId(): string {
    return `${this.messageId}-tool-${++this.fallbackCallCounter}`;
  }

  private registerFallbackId(toolName: string): string {
    const id = this.nextFallbackId();
    const queue = this.pendingIdsByTool.get(toolName) ?? [];
    queue.push(id);
    this.pendingIdsByTool.set(toolName, queue);
    return id;
  }

  private ensureStarted(): void {
    if (this.started) return;
    this.started = true;
    this.emit({ type: EVercelStreamChunkType.START, messageId: this.messageId });
  }

  private openStep(): void {
    this.ensureStarted();
    if (this.stepOpen) return;
    this.stepOpen = true;
    this.emit({ type: EVercelStreamChunkType.START_STEP });
  }

  private closeText(streamKey: string): void {
    const id = this.openTextParts.get(streamKey);
    if (!id) return;
    this.openTextParts.delete(streamKey);
    this.emit({ type: EVercelStreamChunkType.TEXT_END, id });
  }

  private closeStep(): void {
    for (const streamKey of [...this.openTextParts.keys()]) {
      this.closeText(streamKey);
    }
    if (!this.stepOpen) return;
    this.stepOpen = false;
    this.currentStepKind = undefined;
    this.emit({ type: EVercelStreamChunkType.FINISH_STEP });
  }

  // Ghi tuần tự qua 1 hàng đợi (writer có thể async). Lỗi ghi (VD client đã
  // ngắt kết nối) không bao giờ ném ngược vào engine: ghi nhận, ngừng gửi tiếp
  // và huỷ đăng ký để không rò listener.
  private emit(chunk: UIMessageChunk): void {
    this.writeChain = this.writeChain.then(async () => {
      if (this.broken) return;
      try {
        await this.write(chunk);
      } catch (error) {
        this.broken = true;
        this.detachListener?.();
        this.logger.warn(
          `UI stream write failed, stopping adapter for message ${this.messageId}: ${(error as Error).message}`,
        );
      }
    });
  }
}
