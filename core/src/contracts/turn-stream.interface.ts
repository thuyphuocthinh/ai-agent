import type { UIMessageChunk } from 'ai';

/**
 * Giao diện đại diện cho một luồng phản hồi turn hoàn chỉnh gửi về client.
 */
export interface TurnStream {
  sessionId: string;
  stream: ReadableStream<UIMessageChunk>;
  cancel: () => Promise<void>;
  close?: () => void;
}

/**
 * Giao diện đại diện cho một Active Turn đang thực thi và điều phối các kênh stream.
 */
export interface ActiveTurn {
  stream: ReadableStream<UIMessageChunk>;
  close: () => void;
  fail: (error: unknown) => Promise<void>;
  cancel: () => Promise<void>;
}
