// Bộ dữ liệu mẫu CỐ ĐỊNH cho provider tool giả (MOCK_TOOLS=true). Kết quả luôn
// giống nhau giữa các lần chạy để test lặp lại được. KHÔNG phải dữ liệu thật.
export type MockRow = Record<string, string | number>;

export const MOCK_SQL_TABLES: Record<string, MockRow[]> = {
  products: [
    { id: 1, name: 'Áo thun', price: 99000, stock: 50 },
    { id: 2, name: 'Quần jean', price: 299000, stock: 20 },
    { id: 3, name: 'Giày thể thao', price: 699000, stock: 8 },
  ],
  orders: [
    { id: 101, customer: 'An', total: 398000, status: 'paid', created_at: '2026-10-01' },
    { id: 102, customer: 'Bình', total: 699000, status: 'pending', created_at: '2026-10-02' },
    { id: 103, customer: 'Chi', total: 99000, status: 'paid', created_at: '2026-10-03' },
  ],
  payments: [
    { id: 1, order_id: 101, amount: 398000, status: 'success' },
    { id: 2, order_id: 103, amount: 99000, status: 'success' },
  ],
};

export function describeMockSchema(table?: string): string | undefined {
  const names = table ? [table.toLowerCase()] : Object.keys(MOCK_SQL_TABLES);
  if (names.some((name) => !MOCK_SQL_TABLES[name])) return undefined;
  return names
    .map((name) => {
      const columns = Object.entries(MOCK_SQL_TABLES[name][0])
        .map(([column, value]) => `${column} ${typeof value === 'number' ? 'int' : 'varchar'}`)
        .join(', ');
      return `${name}(${columns})`;
    })
    .join('\n');
}

export type MockQueryResult =
  | { ok: true; rows: MockRow[] }
  | { ok: false; error: string };

const SELECT_PATTERN =
  /^\s*select\s+(?<select>.+?)\s+from\s+(?<table>\w+)(?:\s+where\s+(?<where>.+?))?(?:\s+limit\s+(?<limit>\d+))?\s*;?\s*$/is;
const WHERE_PATTERN = /^(?<column>\w+)\s*=\s*(?:'(?<text>[^']*)'|(?<number>-?\d+(?:\.\d+)?))$/;
const AGGREGATE_PATTERN = /^(?<fn>count|sum)\(\s*(?<arg>\*|\w+)\s*\)(?:\s+as\s+\w+)?$/i;

/**
 * Bộ chạy SELECT tối giản cho dữ liệu mẫu: SELECT (dấu sao, danh sách cột,
 * COUNT, SUM) FROM bảng [WHERE cột = giá trị] [LIMIT n]. Cú pháp khác trả lỗi rõ ràng thay vì
 * đoán, để kết quả giả không bao giờ làm người test hiểu nhầm.
 */
export function runMockSelect(query: string): MockQueryResult {
  const match = SELECT_PATTERN.exec(query);
  if (!match?.groups) {
    return {
      ok: false,
      error:
        'read_query (mock) chỉ hỗ trợ: SELECT */cột/COUNT(*)/SUM(cột) FROM bảng [WHERE cột = giá trị] [LIMIT n]',
    };
  }
  const table = MOCK_SQL_TABLES[match.groups.table.toLowerCase()];
  if (!table) {
    return {
      ok: false,
      error: `Bảng "${match.groups.table}" không tồn tại. Bảng có sẵn: ${Object.keys(MOCK_SQL_TABLES).join(', ')}`,
    };
  }

  let rows = table;
  if (match.groups.where) {
    const where = WHERE_PATTERN.exec(match.groups.where.trim());
    if (!where?.groups) {
      return {
        ok: false,
        error: 'read_query (mock) chỉ hỗ trợ WHERE với đúng 1 điều kiện dạng cột = giá trị',
      };
    }
    const column = where.groups.column;
    if (!(column in table[0])) {
      return { ok: false, error: `Cột "${column}" không tồn tại` };
    }
    const wanted = where.groups.text ?? Number(where.groups.number);
    rows = rows.filter((row) => row[column] === wanted);
  }
  if (match.groups.limit) {
    rows = rows.slice(0, Number(match.groups.limit));
  }

  const select = match.groups.select.trim();
  const aggregate = AGGREGATE_PATTERN.exec(select);
  if (aggregate?.groups) {
    if (aggregate.groups.fn.toLowerCase() === 'count') {
      return { ok: true, rows: [{ count: rows.length }] };
    }
    const column = aggregate.groups.arg;
    if (column === '*' || !(column in table[0]) || typeof table[0][column] !== 'number') {
      return { ok: false, error: `SUM chỉ áp dụng cho cột số, "${column}" không hợp lệ` };
    }
    return {
      ok: true,
      rows: [{ sum: rows.reduce((total, row) => total + Number(row[column]), 0) }],
    };
  }
  if (select === '*') return { ok: true, rows };

  const columns = select.split(',').map((c) => c.trim());
  const unknown = columns.find((c) => !(c in table[0]));
  if (unknown) return { ok: false, error: `Cột "${unknown}" không tồn tại` };
  return {
    ok: true,
    rows: rows.map((row) => Object.fromEntries(columns.map((c) => [c, row[c]]))),
  };
}
