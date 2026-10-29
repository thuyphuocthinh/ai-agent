import { randomUUID } from 'crypto';
import {
  CompressOptions,
  CompressedToolOutput,
} from '../../contracts/tools/tool-compression.types';

/**
 * ToolOutputCompressor
 * Bảo vệ Token Budget khi Tool (SQL, Kintone, API) trả về payload khổng lồ (> 20.000 ký tự).
 * Tự động cắt gọt an toàn giữ nguyên tính hợp lệ của JSON envelope, trích xuất mẫu (sample rows),
 * và lưu trữ con trỏ dữ liệu (Data Reference) cho các bước sau sử dụng.
 */
export class ToolOutputCompressor {
  private static readonly rawCache = new Map<
    string,
    { payload: string; createdAt: number }
  >();
  public static readonly DEFAULT_MAX_CHARS = 20_000;
  public static readonly DEFAULT_SAMPLE_COUNT = 3;
  private static readonly CACHE_TTL_MS = 30 * 60 * 1000; // 30 phút

  /**
   * Nén an toàn dữ liệu payload từ tool
   */
  static compress(
    rawInput: unknown,
    options: CompressOptions = {},
  ): CompressedToolOutput {
    const maxChars = options.maxCharacters ?? this.DEFAULT_MAX_CHARS;
    const sampleCount = options.sampleCount ?? this.DEFAULT_SAMPLE_COUNT;
    const storeRaw = options.storeRawPayload ?? true;

    const rawText =
      typeof rawInput === 'string'
        ? rawInput
        : JSON.stringify(rawInput, null, 2);

    const originalLength = rawText.length;

    // Fast path: Dữ liệu nhỏ hơn ngưỡng thì giữ nguyên 100%
    if (originalLength <= maxChars) {
      return {
        text: rawText,
        isTruncated: false,
        originalLength,
      };
    }

    // Dữ liệu vượt ngưỡng: Tạo data reference để lưu trữ payload thô
    let dataRef: string | undefined;
    if (storeRaw) {
      dataRef = `ref_data_${randomUUID().replace(/-/g, '')}`;
      this.rawCache.set(dataRef, {
        payload: rawText,
        createdAt: Date.now(),
      });
      this.cleanExpiredCache();
    }

    // Thử parse JSON để nén có cấu trúc (Structured Compression)
    try {
      const parsed = typeof rawInput === 'string' ? JSON.parse(rawInput) : rawInput;

      if (Array.isArray(parsed)) {
        return this.compressArray(parsed, maxChars, sampleCount, originalLength, dataRef);
      }

      if (parsed && typeof parsed === 'object') {
        return this.compressObject(parsed, maxChars, sampleCount, originalLength, dataRef);
      }
    } catch {
      // Không phải JSON hợp lệ -> Fallback sang nén dạng text
    }

    return this.compressRawText(rawText, maxChars, originalLength, dataRef);
  }

  /**
   * Lấy lại payload thô đầy đủ từ Data Reference ID (dành cho Python Execution / Batch Updater)
   */
  static getRawPayload(dataRef: string): string | null {
    const entry = this.rawCache.get(dataRef);
    if (!entry) return null;
    return entry.payload;
  }

  /**
   * Xóa cache phục vụ test hoặc dọn dẹp
   */
  static clearCache(): void {
    this.rawCache.clear();
  }

  private static compressArray(
    arr: unknown[],
    maxChars: number,
    sampleCount: number,
    originalLength: number,
    dataRef?: string,
  ): CompressedToolOutput {
    const totalCount = arr.length;
    let head = arr.slice(0, sampleCount);
    let tail = arr.slice(-1);

    let compressedEnvelope = {
      _data_summary: {
        total_records: totalCount,
        retained_samples: head.length + tail.length,
        is_truncated: true,
        notice: `Dữ liệu gốc gồm ${totalCount} bản ghi (${originalLength} ký tự) đã được cắt gọt an toàn để bảo vệ context.`,
        dataRef: dataRef ?? null,
      },
      sample_records: [...head, ...tail],
    };

    let resultText = JSON.stringify(compressedEnvelope, null, 2);
    if (resultText.length <= maxChars) {
      return {
        text: resultText,
        isTruncated: true,
        originalLength,
        dataRef,
      };
    }

    // Nếu các bản ghi mẫu quá lớn làm vượt quá maxChars, giảm mẫu xuống 1 bản ghi
    head = arr.slice(0, 1);
    tail = [];
    compressedEnvelope = {
      _data_summary: {
        total_records: totalCount,
        retained_samples: 1,
        is_truncated: true,
        notice: `Dữ liệu gốc gồm ${totalCount} bản ghi (${originalLength} ký tự) đã được cắt gọt an toàn để bảo vệ context.`,
        dataRef: dataRef ?? null,
      },
      sample_records: head,
    };
    resultText = JSON.stringify(compressedEnvelope, null, 2);
    if (resultText.length <= maxChars) {
      return {
        text: resultText,
        isTruncated: true,
        originalLength,
        dataRef,
      };
    }

    return this.compressRawText(resultText, maxChars, originalLength, dataRef);
  }

  private static compressObject(
    obj: Record<string, unknown>,
    maxChars: number,
    sampleCount: number,
    originalLength: number,
    dataRef?: string,
  ): CompressedToolOutput {
    const clone: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(obj)) {
      if (Array.isArray(value) && value.length > sampleCount) {
        clone[key] = {
          _array_summary: {
            total_items: value.length,
            sample: value.slice(0, sampleCount),
            is_truncated: true,
          },
        };
      } else {
        clone[key] = value;
      }
    }

    clone._truncation_metadata = {
      original_length: originalLength,
      dataRef: dataRef ?? null,
      notice: 'Object payload contains truncated nested collections to fit token budget.',
    };

    const resultText = JSON.stringify(clone, null, 2);
    if (resultText.length <= maxChars) {
      return {
        text: resultText,
        isTruncated: true,
        originalLength,
        dataRef,
      };
    }

    return this.compressRawText(resultText, maxChars, originalLength, dataRef);
  }

  private static compressRawText(
    text: string,
    maxChars: number,
    originalLength: number,
    dataRef?: string,
  ): CompressedToolOutput {
    const headChars = Math.floor(maxChars * 0.7);
    const tailChars = Math.floor(maxChars * 0.2);

    const head = text.slice(0, headChars);
    const tail = text.slice(-tailChars);
    const truncatedCount = originalLength - headChars - tailChars;

    const truncatedText = [
      head,
      `\n\n... [CẮT BỚT ${truncatedCount} KÝ TỰ VÌ VƯỢT QUÁ TOKEN BUDGET] ...\n[DATA REFERENCE ID: ${dataRef ?? 'none'}]\n\n`,
      tail,
    ].join('');

    return {
      text: truncatedText,
      isTruncated: true,
      originalLength,
      dataRef,
    };
  }

  private static cleanExpiredCache(): void {
    const now = Date.now();
    for (const [key, entry] of this.rawCache.entries()) {
      if (now - entry.createdAt > this.CACHE_TTL_MS) {
        this.rawCache.delete(key);
      }
    }
  }
}
