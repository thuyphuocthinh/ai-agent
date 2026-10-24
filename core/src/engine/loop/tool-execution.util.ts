export interface ParsedInsertValues {
  insertPrefix: string; // "INSERT INTO Products (Name, Price) VALUES"
  tableSignature: string; // định danh bảng+cột, để gộp tuple giữa nhiều lần gọi
  tuples: string[]; // VD "('A', 1)"
}

export function parseInsertValues(query: string): ParsedInsertValues | null {
  const trimmed = query.trim();
  const match = /^INSERT\s+INTO\s+(\S+)\s*(\([^)]*\))?\s*VALUES\s*/i.exec(
    trimmed,
  );
  if (!match) return null;

  const [prefixText, table, columns] = match;
  const tuples = extractTopLevelTuples(trimmed.slice(prefixText.length));
  if (tuples.length === 0) return null;

  return {
    insertPrefix: trimmed.slice(0, prefixText.length).trim(),
    tableSignature: `${table.toLowerCase()}|${(columns ?? '').replace(/\s+/g, '').toLowerCase()}`,
    tuples,
  };
}

function extractTopLevelTuples(valuesText: string): string[] {
  const tuples: string[] = [];
  let depth = 0;
  let tupleStart = -1;
  let inString = false;

  for (let i = 0; i < valuesText.length; i++) {
    const ch = valuesText[i];
    if (inString) {
      if (ch === "'") {
        if (valuesText[i + 1] === "'") {
          i++;
          continue;
        }
        inString = false;
      }
      continue;
    }
    if (ch === "'") {
      inString = true;
    } else if (ch === '(') {
      if (depth === 0) tupleStart = i;
      depth++;
    } else if (ch === ')') {
      depth = Math.max(0, depth - 1);
      if (depth === 0 && tupleStart !== -1) {
        tuples.push(valuesText.slice(tupleStart, i + 1));
        tupleStart = -1;
      }
    } else if (ch === ';' && depth === 0) {
      break;
    }
  }

  return tuples;
}

export const RETRYABLE_HTTP_STATUS_CODES = new Set([429, 502, 503, 504]);
export type ToolErrorClass = 'retryable' | 'permanent';

interface ParsedToolError {
  retryable?: boolean;
}

export function classifyToolError(resultPreview: string): ToolErrorClass {
  try {
    const parsed: unknown = JSON.parse(resultPreview);
    if (
      parsed !== null &&
      typeof parsed === 'object' &&
      (parsed as ParsedToolError).retryable === true
    ) {
      return 'retryable';
    }
    return 'permanent';
  } catch {
    return 'permanent';
  }
}
