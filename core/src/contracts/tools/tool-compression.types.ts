/**
 * Tool Compression Types & Contracts
 * Định nghĩa cấu trúc tham số và kết quả nén dữ liệu từ Tool (SQL, Kintone, API)
 * nhằm bảo vệ Token Budget và cung cấp con trỏ dữ liệu thô (dataRef).
 */

export interface CompressOptions {
  /** Giới hạn ký tự tối đa cho context LLM (mặc định 20,000 chars ~ 5,000 tokens) */
  readonly maxCharacters?: number;
  /** Số bản ghi mẫu được giữ lại khi truncate array (mặc định 3 ở đầu + 1 ở cuối) */
  readonly sampleCount?: number;
  /** Có lưu payload thô vào cache để downstream (như Python script) truy vấn không */
  readonly storeRawPayload?: boolean;
}

export interface CompressedToolOutput {
  readonly text: string;
  readonly isTruncated: boolean;
  readonly originalLength: number;
  readonly dataRef?: string;
}
