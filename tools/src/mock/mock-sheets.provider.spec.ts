import { createMockSheetsProvider } from './mock-sheets.provider';

describe('mock google_sheets provider', () => {
  let provider: ReturnType<typeof createMockSheetsProvider>;
  const call = (name: string, args: Record<string, unknown> = {}) => provider.call(name, args);
  const text = (r: { content?: Array<{ text?: string }> }) => r.content?.[0]?.text ?? '';
  const read = (args: Record<string, unknown>) => {
    const result = call('read_range', { spreadsheet_id: 'sheet_prices', ...args });
    expect(result.isError).toBe(false);
    return JSON.parse(text(result)).values;
  };

  beforeEach(() => {
    provider = createMockSheetsProvider();
  });

  it('offers the read tools as read-only and the write tools as destructive', () => {
    const hints = Object.fromEntries(provider.tools.map((t) => [t.name, t.annotations]));

    expect(hints).toEqual({
      list_spreadsheets: { readOnlyHint: true },
      read_range: { readOnlyHint: true },
      append_rows: { destructiveHint: true },
      update_cells: { destructiveHint: true },
    });
  });

  it('lists both spreadsheets with their tabs', () => {
    expect(JSON.parse(text(call('list_spreadsheets')))).toEqual([
      { id: 'sheet_prices', name: 'Bảng giá nhà cung cấp', tabs: ['Giá'] },
      { id: 'sheet_plan', name: 'Kế hoạch nhập hàng Q4', tabs: ['Kế hoạch'] },
    ]);
  });

  describe('read_range', () => {
    it('reads the whole first tab when no range is given', () => {
      const values = read({});

      expect(values).toHaveLength(5);
      expect(values[0]).toEqual(['Sản phẩm', 'Nhà cung cấp', 'Giá nhập', 'Giá đề xuất']);
      expect(values[3]).toEqual(['Giày thể thao', 'Sneaker Hub', 520000, 699000]);
    });

    it('reads a rectangle, a column slice, whole columns and a single cell', () => {
      expect(read({ range: 'Giá!A1:D2' })).toEqual([
        ['Sản phẩm', 'Nhà cung cấp', 'Giá nhập', 'Giá đề xuất'],
        ['Áo thun', 'Dệt Việt', 45000, 99000],
      ]);
      expect(read({ range: 'Giá!C2:C4' })).toEqual([[45000], [160000], [520000]]);
      expect(read({ range: 'Giá!A:B' })).toHaveLength(5);
      expect(read({ range: 'Giá!A:B' })[1]).toEqual(['Áo thun', 'Dệt Việt']);
      expect(read({ range: 'Giá!B3' })).toEqual([['Denim Sài Gòn']]);
    });

    it('accepts a tab name alone or in another case, and a range without a tab', () => {
      expect(JSON.parse(text(call('read_range', { spreadsheet_id: 'sheet_plan', range: 'Kế hoạch' }))).values).toHaveLength(4);
      expect(read({ range: 'giá!B2' })).toEqual([['Dệt Việt']]);
      expect(read({ range: 'A2:A3' })).toEqual([['Áo thun'], ['Quần jean']]);
    });

    it.each([
      ['an unknown spreadsheet', { spreadsheet_id: 'nope' }, 'Id hợp lệ: sheet_prices, sheet_plan'],
      ['a missing spreadsheet id', { spreadsheet_id: '' }, 'Thiếu tham số "spreadsheet_id"'],
      ['an unknown tab', { spreadsheet_id: 'sheet_prices', range: 'Sheet9!A1' }, 'Tab hợp lệ: Giá'],
      ['an invalid range', { spreadsheet_id: 'sheet_prices', range: 'Giá!A1:B2:C3' }, 'không hợp lệ'],
      ['a reversed range', { spreadsheet_id: 'sheet_prices', range: 'Giá!D4:A1' }, 'không hợp lệ'],
    ])('returns a helpful error for %s', (_label, args, message) => {
      const result = call('read_range', args);

      expect(result.isError).toBe(true);
      expect(text(result)).toContain(message);
    });
  });

  describe('append_rows', () => {
    it('adds rows to the end of the tab and a later read sees them', () => {
      const result = call('append_rows', {
        spreadsheet_id: 'sheet_prices',
        rows: [['Dép', 'Dệt Việt', 30000, 79000]],
      });

      expect(result.isError).toBe(false);
      expect(JSON.parse(text(result))).toEqual({ tab: 'Giá', appendedRows: 1, firstRow: 6 });
      expect(read({ range: 'Giá!A6:D6' })).toEqual([['Dép', 'Dệt Việt', 30000, 79000]]);
    });

    it.each([
      ['no rows', { rows: [] }],
      ['rows that are not arrays', { rows: ['a'] }],
      ['an object cell', { rows: [[{ a: 1 }]] }],
    ])('refuses %s', (_label, args) => {
      expect(call('append_rows', { spreadsheet_id: 'sheet_prices', ...args }).isError).toBe(true);
      expect(read({})).toHaveLength(5);
    });

    it('refuses an unknown tab', () => {
      expect(call('append_rows', { spreadsheet_id: 'sheet_prices', tab: 'X', rows: [['a']] }).isError).toBe(true);
    });
  });

  describe('update_cells', () => {
    const readPlan = (range: string) =>
      JSON.parse(text(call('read_range', { spreadsheet_id: 'sheet_plan', range }))).values;

    it('overwrites a cell and a block starting at the top-left cell', () => {
      const single = call('update_cells', { spreadsheet_id: 'sheet_plan', range: 'Kế hoạch!C2', values: [['Đã đặt']] });
      expect(JSON.parse(text(single))).toEqual({ updatedRange: 'Kế hoạch!C2:C2', updatedCells: 1 });
      expect(readPlan('Kế hoạch!A2:C2')).toEqual([['Giày thể thao', 30, 'Đã đặt']]);

      const block = call('update_cells', {
        spreadsheet_id: 'sheet_plan',
        range: 'Kế hoạch!B3:C4',
        values: [[120, 'Đã đặt'], [50, 'Đã đặt']],
      });
      expect(JSON.parse(text(block))).toEqual({ updatedRange: 'Kế hoạch!B3:C4', updatedCells: 4 });
      expect(readPlan('Kế hoạch!A3:C4')).toEqual([['Áo thun', 120, 'Đã đặt'], ['Quần jean', 50, 'Đã đặt']]);
    });

    it('extends the tab when writing below the existing data', () => {
      call('update_cells', { spreadsheet_id: 'sheet_plan', range: 'Kế hoạch!A6', values: [['Mũ', 10, 'Chờ duyệt']] });

      expect(readPlan('Kế hoạch!A6:C6')).toEqual([['Mũ', 10, 'Chờ duyệt']]);
    });

    it('refuses a range without a start cell and invalid values', () => {
      const noStart = call('update_cells', { spreadsheet_id: 'sheet_plan', range: 'Kế hoạch!A:B', values: [['x']] });
      expect(noStart.isError).toBe(true);
      expect(text(noStart)).toContain('ô bắt đầu');
      expect(call('update_cells', { spreadsheet_id: 'sheet_plan', range: 'Kế hoạch!A2', values: [] }).isError).toBe(true);
    });
  });

  it('describes the spreadsheets, tabs and headers as a resource that follows later writes', () => {
    const [resource] = provider.resources;
    expect(resource.read()).toContain('sheet_prices: Bảng giá nhà cung cấp');
    expect(resource.read()).toContain('tab "Giá": Sản phẩm | Nhà cung cấp | Giá nhập | Giá đề xuất (4 dòng dữ liệu)');

    call('append_rows', { spreadsheet_id: 'sheet_prices', rows: [['Dép', 'Dệt Việt', 1, 2]] });

    expect(resource.read()).toContain('(5 dòng dữ liệu)');
  });

  it('starts from the original data again on a new instance', () => {
    call('append_rows', { spreadsheet_id: 'sheet_prices', rows: [['Dép', 'Dệt Việt', 1, 2]] });

    provider = createMockSheetsProvider();

    expect(read({})).toHaveLength(5);
  });
});
