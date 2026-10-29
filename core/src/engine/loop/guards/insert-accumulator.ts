import { buildInsertShortfallMessage } from '../utils/react-loop-prompt.util';
import { parseInsertValues } from '../utils/tool-execution.util';

export type InsertShortfallOutcome =
  | { mergedQuery: string }
  | { shortfallMessage: string }
  | null;

/** Gộp tuple INSERT rải qua nhiều lần gọi (khoá theo table+cột) — tách khỏi
 * ReactLoopRun để test được trực tiếp thay vì chỉ suy ra qua số lần gọi mock. */
export class InsertAccumulator {
  private readonly tables = new Map<
    string,
    { insertPrefix: string; tuples: Set<string> }
  >();

  tableKeyFor(query: string): string | null {
    return parseInsertValues(query)?.tableSignature ?? null;
  }

  // Trả null khi query không parse được thành INSERT tuple (không phải lỗi —
  // caller tự quyết định làm gì tiếp, VD coi như không phải bulk-insert).
  checkShortfall(query: string, requiredCount: number): InsertShortfallOutcome {
    const parsed = parseInsertValues(query);
    if (!parsed) return null;

    const entry = this.tables.get(parsed.tableSignature) ?? {
      insertPrefix: parsed.insertPrefix,
      tuples: new Set<string>(),
    };
    parsed.tuples.forEach((t) => entry.tuples.add(t));
    this.tables.set(parsed.tableSignature, entry);

    const tuples = Array.from(entry.tuples);
    if (tuples.length >= requiredCount) {
      return { mergedQuery: `${entry.insertPrefix} ${tuples.join(', ')}` };
    }
    return {
      shortfallMessage: buildInsertShortfallMessage(tuples.length, requiredCount),
    };
  }

  clear(query: string): void {
    const tableSignature = parseInsertValues(query)?.tableSignature;
    if (tableSignature) this.tables.delete(tableSignature);
  }
}
