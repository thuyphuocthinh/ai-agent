import type { UIMessageChunk } from 'ai';
import { AgentStreamContext, AgentStreamStep } from './stream-sink.interface';

/**
 * Nguồn cung cấp các bước Agent Stream mà Adapter cần (thông qua hook onStep).
 */
export interface AgentStepSource {
  onStep(
    listener: (context: AgentStreamContext, step: AgentStreamStep) => void,
  ): () => void;
}

/**
 * Hàm ghi các chunk theo định dạng UI của Vercel AI SDK.
 */
export type UiChunkWriter = (chunk: UIMessageChunk) => void | Promise<void>;

/**
 * Tùy chọn cấu hình cho Vercel UI Stream Adapter.
 */
export interface VercelUiStreamOptions {
  /**
   * messageId của tin nhắn bot (reply) — chỉ event của message này được chuyển tiếp.
   */
  messageId?: string;
  write: UiChunkWriter;
}
