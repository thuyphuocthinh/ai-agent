import type { UIMessageChunk } from 'ai';
import { AgentStreamContext, AgentStreamStep } from './stream-sink.interface';

export const TURN_EVENT_LOG = Symbol('TURN_EVENT_LOG');

export enum ETurnLogStatus {
  ACTIVE = 'active',
  PAUSED = 'paused',
  DONE = 'done',
  FAILED = 'failed',
  CANCELLED = 'cancelled',
}

// Loại dòng trong event log (cũng là giá trị lưu trong Redis, không đổi định dạng).
export enum ETurnLogEntryKind {
  STEP = 'step',
  CHUNK = 'chunk',
}

export interface TurnLogMeta {
  messageId: string;
  conversationId?: string;
  userId?: string;
  status: ETurnLogStatus;
  startedAt: number;
  updatedAt: number;
}

export interface TurnLogStartDto {
  messageId: string;
  conversationId?: string;
  userId?: string;
}

/**
 * Một dòng của event log. `step` là event thô của engine (adapter dựng lại chunk
 * UI từ đó); `chunk` là chunk UI dựng sẵn cho các thứ KHÔNG đi qua step
 * (câu trả lời cuối, yêu cầu duyệt/làm rõ).
 */
export type TurnLogEntry =
  | { id: string; kind: ETurnLogEntryKind.STEP; context: AgentStreamContext; step: AgentStreamStep }
  | { id: string; kind: ETurnLogEntryKind.CHUNK; chunk: UIMessageChunk };

/**
 * Event log append-only, có thứ tự, theo turn. Nguồn sự thật duy nhất để dựng lại
 * stream khi client reload/reconnect: phát lại từ đầu rồi bám theo phần đuôi.
 */
export interface ITurnEventLog {
  /** Đánh dấu turn ACTIVE (gọi trước event đầu tiên). */
  start(dto: TurnLogStartDto): Promise<void>;

  /** Ghi 1 step của engine. Thứ tự gọi = thứ tự trong log. */
  appendStep(
    messageId: string,
    context: AgentStreamContext,
    step: AgentStreamStep,
  ): Promise<void>;

  /** Ghi 1 chunk UI dựng sẵn (data-reply, data-approval, data-clarification...). */
  appendChunk(messageId: string, chunk: UIMessageChunk): Promise<void>;

  /**
   * Bắt đầu phát nhịp tim cho turn đang chạy (worker gọi). Trả hàm dừng nhịp tim.
   * Không có nhịp tim = worker đã chết → turn ACTIVE được coi là bị bỏ dở.
   */
  startHeartbeat(messageId: string): () => void;

  /** Worker của turn còn nhịp tim không. */
  isAlive(messageId: string): Promise<boolean>;

  /** Chốt trạng thái cuối của turn và đặt hạn sống ngắn cho log. */
  finish(messageId: string, status: ETurnLogStatus): Promise<void>;

  getMeta(messageId: string): Promise<TurnLogMeta | null>;

  /** messageId của turn đang ACTIVE gần nhất trong conversation (nếu có). */
  findActiveTurnId(conversationId: string): Promise<string | null>;

  /** Đọc toàn bộ log hiện có (không chờ) — dùng khi cần tổng hợp phần dở dang. */
  snapshot(messageId: string): Promise<TurnLogEntry[]>;

  /**
   * Phát lại log từ ĐẦU rồi bám theo phần đuôi cho đến khi turn kết thúc hoặc
   * `signal` bị huỷ. Generator tự đóng kết nối riêng của nó khi kết thúc.
   */
  read(
    messageId: string,
    signal?: AbortSignal,
  ): AsyncGenerator<TurnLogEntry, void, undefined>;
}
