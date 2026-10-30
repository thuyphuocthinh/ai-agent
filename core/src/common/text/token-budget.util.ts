import {
  ContextCapper,
  PayloadMinifier,
  MarkupCleaner,
  PayloadCompressor,
  JsonValue,
} from 'agentic-io-parser';
import { ToolOutputCompressor } from './tool-output-compressor';

const DEFAULT_MODEL_CONTEXT_TOKENS: Record<string, number> = {
  'gemini-1.5-pro': 2_000_000,
  'gemini-1.5-flash': 1_000_000,
  'gemini-2.0-flash-exp': 1_000_000,
  'gpt-4o': 128_000,
  'gpt-4o-mini': 128_000,
  'claude-3-5-sonnet-20241022': 200_000,
  'claude-3-5-haiku-20241022': 200_000,
};

const READ_ONLY_VERBS = new Set([
  'xem',
  'tra',
  'kiểm',
  'lấy',
  'tìm',
  'liệt',
  'kê',
  'get',
  'list',
  'show',
  'query',
  'search',
  'fetch',
  'describe',
  'select',
]);

function splitWords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

export function isLikelyReadOnlyRound(round: { task: string }): boolean {
  return splitWords(round.task).some((word) => READ_ONLY_VERBS.has(word));
}

export const MAX_TOOL_RESULT_CHARS = 6000;
const TRUNCATION_MARKER_OVERHEAD_RESERVE = 40;

const minifier = new PayloadMinifier({
  removeNulls: true,
  removeEmptyArrays: true,
  removeEmptyObjects: true,
});
const cleaner = new MarkupCleaner({ stripHtml: true });
const compressor = new PayloadCompressor();

export function capToolResultSize(
  text: string,
  maxChars: number = MAX_TOOL_RESULT_CHARS,
): string {
  if (maxChars <= TRUNCATION_MARKER_OVERHEAD_RESERVE) {
    return text.length > maxChars ? text.slice(0, Math.max(0, maxChars)) : text;
  }

  let input: unknown = text;
  try {
    input = JSON.parse(text);
  } catch {
    // Plain text, not JSON
  }

  const effectiveMaxChars = maxChars - TRUNCATION_MARKER_OVERHEAD_RESERVE;
  const headLength = Math.floor(effectiveMaxChars * 0.6);
  const tailLength = Math.floor(effectiveMaxChars * 0.4);
  const capper = new ContextCapper({
    maxLength: maxChars,
    headLength,
    tailLength,
  });

  let payload = input as JsonValue;

  // Nếu input là chuỗi JSON string (kết quả MCP), thử parse để bảo toàn cấu trúc mảng/đối tượng
  if (typeof input === 'string') {
    const trimmed = input.trim();
    if (
      (trimmed.startsWith('[') && trimmed.endsWith(']')) ||
      (trimmed.startsWith('{') && trimmed.endsWith('}'))
    ) {
      try {
        payload = JSON.parse(trimmed) as JsonValue;
      } catch {
        // Không phải JSON hợp lệ, giữ nguyên payload dạng chuỗi
      }
    }
  }

  payload = minifier.minify(payload);
  payload = cleaner.clean(payload);

  let dictionaryStr = '';
  if (
    typeof payload === 'object' &&
    payload !== null &&
    JSON.stringify(payload).length > maxChars
  ) {
    // 1. Thử nén có cấu trúc (Structured Compression): Bảo toàn mảng JSON + sinh dataRef lưu cache
    const structured = ToolOutputCompressor.compress(payload, {
      maxCharacters: maxChars,
      sampleCount: 3,
    });
    if (structured.isTruncated && structured.text.length <= maxChars) {
      return structured.text;
    }

    // 2. Nếu là mảng JSON vượt ngân sách (hoặc cấu trúc mẫu vẫn vượt maxChars),
    // cắt gọt an toàn theo ranh giới phần tử, đóng ngoặc ']' hợp lệ và chèn _metadata
    if (Array.isArray(payload)) {
      const preservedItems: unknown[] = [];
      let currentLength = 2; // Cho cặp ngoặc '[' và ']'
      for (let i = 0; i < payload.length; i++) {
        const itemStr = JSON.stringify(payload[i]);
        const addedLength =
          (preservedItems.length > 0 ? 1 : 0) + itemStr.length;
        if (currentLength + addedLength > maxChars - 120) {
          const remaining = payload.length - i;
          preservedItems.push({
            _metadata: `... đã cắt bớt ${remaining} phần tử do vượt ngân sách ...`,
          });
          return JSON.stringify(preservedItems);
        }
        preservedItems.push(payload[i]);
        currentLength += addedLength;
      }
      return JSON.stringify(preservedItems);
    }

    // 3. Fallback: Dùng PayloadCompressor từ agentic-io-parser để alias keys
    const { compressed, dictionary } = compressor.compress(payload);
    payload = compressed;
    if (Object.keys(dictionary).length > 0) {
      dictionaryStr = `\n[MAPPING_KEYS: ${JSON.stringify(dictionary)}]`;
    }
  }

  payload = capper.cap(payload);

  let resultStr =
    typeof payload === 'string' ? payload : JSON.stringify(payload);
  resultStr += dictionaryStr;

  if (resultStr.length > maxChars) {
    const head = resultStr.substring(0, headLength);
    const tail = resultStr.substring(resultStr.length - tailLength);
    return `${head}\n...[truncated ${resultStr.length - maxChars} chars]...\n${tail}`;
  }

  return resultStr;
}

export const CHARS_PER_TOKEN_ESTIMATE = 4;
const DATA_BUDGET_FRACTION = 0.3;
const MAX_DATA_CHARS_CEILING = 200_000;

export function resolveDataCharBudget(modelId: string): number {
  const tokens = DEFAULT_MODEL_CONTEXT_TOKENS[modelId];
  if (!tokens) return MAX_TOOL_RESULT_CHARS;

  const scaled = Math.floor(
    tokens * CHARS_PER_TOKEN_ESTIMATE * DATA_BUDGET_FRACTION,
  );
  return Math.min(scaled, MAX_DATA_CHARS_CEILING);
}

const MEMORY_BUDGET_FRACTION = 0.1;

export function resolveMemoryCharBudget(modelId: string): number {
  return Math.floor(resolveDataCharBudget(modelId) * MEMORY_BUDGET_FRACTION);
}

const HISTORY_BUDGET_FRACTION = 0.5;

export function resolveHistoryCharBudget(modelId: string): number {
  return Math.floor(resolveDataCharBudget(modelId) * HISTORY_BUDGET_FRACTION);
}

export function capRoundResults<T extends { result: string }>(
  rounds: readonly T[],
  totalBudget: number = MAX_TOOL_RESULT_CHARS,
): T[] {
  if (rounds.length === 0) return [...rounds];
  const perRoundBudget = Math.floor(totalBudget / rounds.length);
  return rounds.map((r) => ({
    ...r,
    result: capToolResultSize(r.result, perRoundBudget),
  }));
}

const IRREPLACEABLE_WEIGHT = 2;

export function capRoundResultsWeighted<
  T extends { task: string; result: string },
>(rounds: readonly T[], totalBudget: number = MAX_TOOL_RESULT_CHARS): T[] {
  if (rounds.length === 0) return [...rounds];

  const weights = rounds.map((r) =>
    isLikelyReadOnlyRound(r) ? 1 : IRREPLACEABLE_WEIGHT,
  );
  const totalWeight = weights.reduce((sum, w) => sum + w, 0);

  return rounds.map((r, i) => ({
    ...r,
    result: capToolResultSize(
      r.result,
      Math.floor((totalBudget * weights[i]) / totalWeight),
    ),
  }));
}
