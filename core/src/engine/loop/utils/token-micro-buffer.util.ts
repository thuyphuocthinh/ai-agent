/**
 * TokenMicroBuffer
 *
 * Tiện ích đệm token siêu nhỏ (Micro-buffering) nhằm giảm tải tần suất I/O pub-sub qua Redis Streams / SSE.
 * Thay vì bắn từng ký tự rời rạc (100 msg/s khi LLM stream), buffer gom các chunk nhỏ lại và chỉ phát tán khi:
 * 1. Đạt ngưỡng kích thước đệm (mặc định 25 ký tự)
 * 2. Gặp dấu ngắt câu hoặc xuống dòng (., !, ?, \n)
 * 3. Hết thời gian chờ micro-interval (mặc định 40ms)
 */
export interface TokenMicroBufferOptions {
  maxChars?: number;
  maxIntervalMs?: number;
}

export class TokenMicroBuffer {
  private buffer = '';
  private timer: NodeJS.Timeout | null = null;
  private readonly maxChars: number;
  private readonly maxIntervalMs: number;

  constructor(
    private readonly onFlush: (bufferedText: string) => void,
    options?: TokenMicroBufferOptions,
  ) {
    this.maxChars = options?.maxChars ?? 25;
    this.maxIntervalMs = options?.maxIntervalMs ?? 40;
  }

  /**
   * Thêm một chunk token vào buffer.
   * Nếu thỏa mãn điều kiện ngắt câu hoặc ngưỡng ký tự, buffer sẽ được flush ngay lập tức.
   */
  add(chunk: string): void {
    if (!chunk) return;
    this.buffer += chunk;

    const hasPunctuation = /[\n.!?]\s*$/.test(this.buffer);
    if (hasPunctuation || this.buffer.length >= this.maxChars) {
      this.flush();
      return;
    }

    if (!this.timer) {
      this.timer = setTimeout(() => this.flush(), this.maxIntervalMs);
      this.timer.unref?.();
    }
  }

  /**
   * Đẩy toàn bộ nội dung còn lại trong buffer ra consumer và hủy timer.
   */
  flush(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.buffer.length === 0) return;
    const textToSend = this.buffer;
    this.buffer = '';
    this.onFlush(textToSend);
  }

  /**
   * Xóa sạch buffer mà không gửi đi (dùng khi resync/rollback text).
   */
  clear(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.buffer = '';
  }
}
