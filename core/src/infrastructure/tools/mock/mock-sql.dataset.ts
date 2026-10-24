import { DatabaseSync } from 'node:sqlite';

// Cơ sở dữ liệu mẫu CỐ ĐỊNH cho provider tool giả (MOCK_TOOLS=true), chạy trên SQLite
// thật trong bộ nhớ (module `node:sqlite` có sẵn của Node, không thêm package) nên mọi
// câu SQL thông thường (JOIN, GROUP BY, CASE, COUNT/SUM...) đều chạy đúng như DB thật.
// KHÔNG phải dữ liệu thật; mỗi lần dựng lại là về đúng dữ liệu ban đầu.
const SAMPLE_DATABASE_SQL = `
  CREATE TABLE products (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    price INTEGER NOT NULL,
    stock INTEGER NOT NULL
  );
  CREATE TABLE orders (
    id INTEGER PRIMARY KEY,
    customer TEXT NOT NULL,
    total INTEGER NOT NULL,
    status TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE payments (
    id INTEGER PRIMARY KEY,
    order_id INTEGER NOT NULL REFERENCES orders(id),
    amount INTEGER NOT NULL,
    status TEXT NOT NULL
  );
  INSERT INTO products VALUES
    (1, 'Áo thun', 99000, 50),
    (2, 'Quần jean', 299000, 20),
    (3, 'Giày thể thao', 699000, 8);
  INSERT INTO orders VALUES
    (101, 'An', 398000, 'paid', '2026-10-01'),
    (102, 'Bình', 699000, 'pending', '2026-10-02'),
    (103, 'Chi', 99000, 'paid', '2026-10-03');
  INSERT INTO payments VALUES
    (1, 101, 398000, 'success'),
    (2, 103, 99000, 'success');
`;

const MAX_ROWS = 200;
const READ_PATTERN = /^\s*(select|with)\b/i;
const WRITE_PATTERN = /^\s*(insert|update|delete)\b/i;

export type MockQueryResult =
  | { ok: true; text: string }
  | { ok: false; error: string };

export function createMockDatabase(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  db.exec(SAMPLE_DATABASE_SQL);
  return db;
}

// Chỉ 1 câu lệnh: SQLite chỉ chạy câu đầu và bỏ phần sau dấu `;`, nên chặn thẳng để
// người test không tưởng 2 câu đã cùng chạy.
function hasSecondStatement(sql: string): boolean {
  return /;\s*\S/.test(sql);
}

function failure(error: unknown): MockQueryResult {
  return { ok: false, error: (error as Error).message };
}

// Cột `status` kèm các giá trị đang có: không có dòng này model đoán `status = 'completed'`
// (giá trị thật là 'success'), câu SQL không lỗi mà trả NULL nên báo sai số liệu.
function describeStatusValues(
  db: DatabaseSync,
  table: string,
  columns: Array<{ name: string }>,
): string[] {
  if (!columns.some((c) => c.name === 'status')) return [];
  const rows = db
    .prepare(`SELECT DISTINCT status FROM ${table} ORDER BY status`)
    .all() as Array<{ status: string }>;
  return [`  status có các giá trị: ${rows.map((r) => `'${r.status}'`).join(', ')}`];
}

export function describeMockSchema(db: DatabaseSync, table?: string): MockQueryResult {
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
    .all() as Array<{ name: string }>;
  const names = table
    ? tables.filter((t) => t.name.toLowerCase() === table.toLowerCase())
    : tables;
  if (names.length === 0) {
    return {
      ok: false,
      error: `Bảng "${table}" không tồn tại. Bảng có sẵn: ${tables.map((t) => t.name).join(', ')}`,
    };
  }
  const text = names
    .map(({ name }) => {
      const columns = db.prepare(`PRAGMA table_info(${name})`).all() as Array<{
        name: string;
        type: string;
      }>;
      const header = `${name}(${columns.map((c) => `${c.name} ${c.type.toLowerCase()}`).join(', ')})`;
      return [header, ...describeStatusValues(db, name, columns)].join('\n');
    })
    .join('\n');
  return { ok: true, text };
}

export function runMockRead(db: DatabaseSync, sql: string): MockQueryResult {
  if (!READ_PATTERN.test(sql)) {
    return { ok: false, error: 'read_query chỉ nhận câu SELECT (hoặc WITH ... SELECT)' };
  }
  if (hasSecondStatement(sql)) {
    return { ok: false, error: 'read_query chỉ chạy 1 câu lệnh mỗi lần' };
  }
  try {
    const rows = db.prepare(sql).all();
    return { ok: true, text: JSON.stringify(rows.slice(0, MAX_ROWS)) };
  } catch (error) {
    return failure(error);
  }
}

export function runMockWrite(db: DatabaseSync, sql: string): MockQueryResult {
  if (!WRITE_PATTERN.test(sql)) {
    return { ok: false, error: 'execute_write_query chỉ nhận INSERT/UPDATE/DELETE' };
  }
  if (hasSecondStatement(sql)) {
    return { ok: false, error: 'execute_write_query chỉ chạy 1 câu lệnh mỗi lần' };
  }
  try {
    const { changes } = db.prepare(sql).run();
    return { ok: true, text: JSON.stringify({ affectedRows: Number(changes) }) };
  } catch (error) {
    return failure(error);
  }
}
