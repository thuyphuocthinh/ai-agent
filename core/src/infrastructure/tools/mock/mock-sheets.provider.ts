import { CallToolResponseDto, McpToolDto } from '../../../contracts/dtos/mcp.dto';
import { MockProvider, errorResult, isToolResult, jsonResult, stringArg } from './mock-provider';

export const MOCK_SHEETS_PROVIDER_ID = 'google_sheets';

type Cell = string | number;
interface Tab {
  name: string;
  rows: Cell[][]; // dòng đầu là header
}
interface Spreadsheet {
  id: string;
  name: string;
  tabs: Tab[];
}

// Dữ liệu liên kết với SQL mẫu: 3 sản phẩm đầu trùng products, "Mũ lưỡi trai" chưa có trong SQL.
const createSpreadsheets = (): Spreadsheet[] => [
  {
    id: 'sheet_prices',
    name: 'Bảng giá nhà cung cấp',
    tabs: [
      {
        name: 'Giá',
        rows: [
          ['Sản phẩm', 'Nhà cung cấp', 'Giá nhập', 'Giá đề xuất'],
          ['Áo thun', 'Dệt Việt', 45000, 99000],
          ['Quần jean', 'Denim Sài Gòn', 160000, 299000],
          ['Giày thể thao', 'Sneaker Hub', 520000, 699000],
          ['Mũ lưỡi trai', 'Dệt Việt', 20000, 59000],
        ],
      },
    ],
  },
  {
    id: 'sheet_plan',
    name: 'Kế hoạch nhập hàng Q4',
    tabs: [
      {
        name: 'Kế hoạch',
        rows: [
          ['Sản phẩm', 'Số lượng', 'Trạng thái'],
          ['Giày thể thao', 30, 'Chờ duyệt'],
          ['Áo thun', 100, 'Đã đặt'],
          ['Quần jean', 40, 'Chờ duyệt'],
        ],
      },
    ],
  },
];

const RANGE_SCHEMA = {
  type: 'string',
  description: 'Vùng dạng "Tên tab!A1:D10", "Tên tab!A:C", "Tên tab!B2" hoặc bỏ trống (cả tab đầu tiên)',
};

const TOOLS: McpToolDto[] = [
  {
    name: 'list_spreadsheets',
    description: 'Liệt kê các bảng tính (id, tên, các tab).',
    inputSchema: { type: 'object', properties: {} },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'read_range',
    description: 'Đọc giá trị trong 1 vùng của bảng tính (dòng đầu của tab là header).',
    inputSchema: {
      type: 'object',
      properties: {
        spreadsheet_id: { type: 'string', description: 'Id bảng tính, lấy từ list_spreadsheets' },
        range: RANGE_SCHEMA,
      },
      required: ['spreadsheet_id'],
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'append_rows',
    description: 'Thêm dòng mới vào cuối 1 tab. Cần người dùng duyệt trước khi chạy.',
    inputSchema: {
      type: 'object',
      properties: {
        spreadsheet_id: { type: 'string' },
        tab: { type: 'string', description: 'Tên tab (bỏ trống = tab đầu tiên)' },
        rows: { type: 'array', items: { type: 'array', items: {} }, description: 'Các dòng, mỗi dòng là mảng giá trị' },
      },
      required: ['spreadsheet_id', 'rows'],
    },
    annotations: { destructiveHint: true },
  },
  {
    name: 'update_cells',
    description: 'Ghi đè giá trị bắt đầu từ ô góc trên-trái của range. Cần người dùng duyệt trước khi chạy.',
    inputSchema: {
      type: 'object',
      properties: {
        spreadsheet_id: { type: 'string' },
        range: { ...RANGE_SCHEMA, description: 'Ô bắt đầu, dạng "Tên tab!C2" hoặc "Tên tab!C2:D3"' },
        values: { type: 'array', items: { type: 'array', items: {} }, description: 'Ma trận giá trị cần ghi' },
      },
      required: ['spreadsheet_id', 'range', 'values'],
    },
    annotations: { destructiveHint: true },
  },
];

const colToIndex = (col: string): number =>
  [...col.toUpperCase()].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;

const toA1 = (row: number, col: number): string => {
  let letters = '';
  for (let n = col + 1; n > 0; n = Math.floor((n - 1) / 26)) {
    letters = String.fromCharCode(65 + ((n - 1) % 26)) + letters;
  }
  return `${letters}${row + 1}`;
};

interface Bounds {
  r0: number;
  r1: number;
  c0: number;
  c1: number;
}

function parseRef(ref: string): { col?: number; row?: number } | null {
  const match = /^([A-Za-z]*)(\d*)$/.exec(ref);
  if (!match || (!match[1] && !match[2])) return null;
  const row = match[2] ? Number(match[2]) - 1 : undefined;
  if (row !== undefined && row < 0) return null;
  return { col: match[1] ? colToIndex(match[1]) : undefined, row };
}

// "" = cả tab; "A1:D10", "A:C", "B2" (1 ô). Cột/dòng bỏ trống nghĩa là không giới hạn.
function parseBounds(cells: string): Bounds | null {
  if (!cells) return { r0: 0, r1: Infinity, c0: 0, c1: Infinity };
  const [from, to = from, extra] = cells.split(':');
  const a = parseRef(from);
  const b = parseRef(to);
  if (extra !== undefined || !a || !b) return null;
  const bounds = { r0: a.row ?? 0, r1: b.row ?? Infinity, c0: a.col ?? 0, c1: b.col ?? Infinity };
  return bounds.r0 <= bounds.r1 && bounds.c0 <= bounds.c1 ? bounds : null;
}

// "Tab!A1:D10" -> {tab, cells}; không có "!" thì chuỗi dạng ô (A1:D5) là vùng, còn lại là tên tab.
function splitRange(range: string): { tab?: string; cells: string } {
  const bang = range.lastIndexOf('!');
  if (bang >= 0) return { tab: range.slice(0, bang), cells: range.slice(bang + 1) };
  return /^[A-Za-z]*\d*(:[A-Za-z]*\d*)?$/.test(range) ? { cells: range } : { tab: range, cells: '' };
}

const isMatrix = (value: unknown): value is Cell[][] =>
  Array.isArray(value) &&
  value.length > 0 &&
  value.every(
    (row) => Array.isArray(row) && row.length > 0 && row.every((c) => typeof c === 'string' || typeof c === 'number'),
  );

/** Google Sheets giả: 2 bảng tính trong bộ nhớ; ghi (append/update) áp dụng ngay và mất khi dựng lại. */
export function createMockSheetsProvider(): MockProvider {
  const sheets = createSpreadsheets();

  const findSheet = (args: Record<string, unknown>): Spreadsheet | CallToolResponseDto => {
    const id = stringArg(args, 'spreadsheet_id');
    if (!id) return errorResult('Thiếu tham số "spreadsheet_id"');
    return (
      sheets.find((s) => s.id === id) ??
      errorResult(`Không tìm thấy bảng tính "${id}". Id hợp lệ: ${sheets.map((s) => s.id).join(', ')}`)
    );
  };
  const findTab = (sheet: Spreadsheet, name?: string): Tab | CallToolResponseDto => {
    const tab = name ? sheet.tabs.find((t) => t.name.toLowerCase() === name.toLowerCase()) : sheet.tabs[0];
    return (
      tab ??
      errorResult(`Không có tab "${name}" trong "${sheet.name}". Tab hợp lệ: ${sheet.tabs.map((t) => t.name).join(', ')}`)
    );
  };

  const readRange: MockProvider['call'] = (_name, args) => {
    const sheet = findSheet(args);
    if (isToolResult(sheet)) return sheet;
    const { tab: tabName, cells } = splitRange(stringArg(args, 'range') ?? '');
    const tab = findTab(sheet, tabName);
    if (isToolResult(tab)) return tab;
    const bounds = parseBounds(cells);
    if (!bounds) return errorResult(`Vùng "${cells}" không hợp lệ. Dùng dạng "Tên tab!A1:D10"`);
    const values = tab.rows.slice(bounds.r0, bounds.r1 + 1).map((row) => row.slice(bounds.c0, bounds.c1 + 1));
    return jsonResult({ spreadsheet: sheet.name, tab: tab.name, range: cells || 'toàn bộ', values });
  };

  const appendRows: MockProvider['call'] = (_name, args) => {
    const sheet = findSheet(args);
    if (isToolResult(sheet)) return sheet;
    const tab = findTab(sheet, stringArg(args, 'tab'));
    if (isToolResult(tab)) return tab;
    if (!isMatrix(args.rows)) return errorResult('"rows" phải là mảng các dòng, mỗi dòng là mảng chuỗi/số, không rỗng');
    const firstRow = tab.rows.length + 1;
    tab.rows.push(...args.rows.map((row) => [...row]));
    return jsonResult({ tab: tab.name, appendedRows: args.rows.length, firstRow });
  };

  const updateCells: MockProvider['call'] = (_name, args) => {
    const sheet = findSheet(args);
    if (isToolResult(sheet)) return sheet;
    const { tab: tabName, cells } = splitRange(stringArg(args, 'range') ?? '');
    const tab = findTab(sheet, tabName);
    if (isToolResult(tab)) return tab;
    const start = parseRef(cells.split(':')[0]);
    if (!start || start.col === undefined || start.row === undefined) {
      return errorResult('"range" phải có ô bắt đầu cụ thể, ví dụ "Kế hoạch!C2"');
    }
    if (!isMatrix(args.values)) return errorResult('"values" phải là ma trận chuỗi/số, không rỗng');
    const { row: firstRow, col: firstCol } = start;
    let updatedCells = 0;
    while (tab.rows.length < firstRow) tab.rows.push([]);
    args.values.forEach((valueRow, i) => {
      const row = (tab.rows[firstRow + i] ??= []);
      valueRow.forEach((value, j) => {
        while (row.length < firstCol + j) row.push('');
        row[firstCol + j] = value;
        updatedCells++;
      });
    });
    const width = Math.max(...args.values.map((r) => r.length));
    const end = toA1(firstRow + args.values.length - 1, firstCol + width - 1);
    return jsonResult({ updatedRange: `${tab.name}!${toA1(firstRow, firstCol)}:${end}`, updatedCells });
  };

  const handlers: Record<string, MockProvider['call']> = {
    list_spreadsheets: () =>
      jsonResult(sheets.map((s) => ({ id: s.id, name: s.name, tabs: s.tabs.map((t) => t.name) }))),
    read_range: readRange,
    append_rows: appendRows,
    update_cells: updateCells,
  };

  return {
    id: MOCK_SHEETS_PROVIDER_ID,
    tools: TOOLS,
    resources: [
      {
        dto: {
          uri: 'mock://google_sheets/catalog',
          name: 'Danh mục bảng tính',
          description: 'Các bảng tính, tab và header',
          mimeType: 'text/plain',
        },
        read: () =>
          sheets
            .map((s) =>
              [
                `${s.id}: ${s.name}`,
                ...s.tabs.map((t) => `  tab "${t.name}": ${t.rows[0].join(' | ')} (${t.rows.length - 1} dòng dữ liệu)`),
              ].join('\n'),
            )
            .join('\n'),
      },
    ],
    call: (name, args) => handlers[name](name, args),
  };
}
