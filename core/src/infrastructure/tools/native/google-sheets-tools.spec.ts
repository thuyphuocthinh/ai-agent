import { GoogleSheetsStructureTool } from './google-sheets-structure.tool';
import { GoogleSheetsBatchUpdateTool } from './google-sheets-batch-update.tool';
import { NativeToolRegistryService } from './native-tool-registry.service';
import { IArtifactTmpManager } from '../../../contracts/storage/artifact-tmp.interface';
import { createMockSheetsProvider } from '../mock/mock-sheets.provider';

describe('GoogleSheets Native Tools & Mock Provider', () => {
  let registry: NativeToolRegistryService;
  let mockTmpManager: jest.Mocked<IArtifactTmpManager>;

  const parse = (res: { content?: Array<{ text?: string }> }) =>
    JSON.parse(res.content?.[0]?.text ?? '{}');

  beforeEach(() => {
    registry = new NativeToolRegistryService();
    mockTmpManager = {
      getTurnDir: jest.fn().mockReturnValue('/tmp/artifacts/turn-123'),
      saveJsonToFile: jest.fn().mockResolvedValue('/tmp/artifacts/turn-123/payload.json'),
      readJsonFromFile: jest.fn(),
      cleanTurnDir: jest.fn().mockResolvedValue(undefined),
      cleanExpiredDirs: jest.fn().mockResolvedValue(0),
    };
  });

  afterEach(() => jest.clearAllMocks());

  describe('GoogleSheetsStructureTool', () => {
    let tool: GoogleSheetsStructureTool;

    beforeEach(() => {
      tool = new GoogleSheetsStructureTool(registry);
    });

    it('registers itself into NativeToolRegistryService onModuleInit', () => {
      tool.onModuleInit();
      expect(registry.hasTool('get_sheet_structure')).toBe(true);
      expect(registry.getAllTools().map((t) => t.name)).toContain('get_sheet_structure');
    });

    it('declares read-only hint and SYSTEM authType in MCP metadata', () => {
      const dto = tool.toMcpToolDto();
      expect(dto.name).toBe('get_sheet_structure');
      expect(dto.annotations?.readOnlyHint).toBe(true);
      expect(dto.authType).toBe('SYSTEM');
    });

    it('returns error when spreadsheetId is missing', async () => {
      const res = await tool.execute({});
      expect(res.isError).toBe(true);
      expect(parse(res)).toMatchObject({
        code: 'INVALID_ARGUMENTS',
        message: 'spreadsheetId là bắt buộc.',
      });
    });

    it('extracts sheet structure with template metadata and protected formula columns', async () => {
      const res = await tool.execute({
        spreadsheetId: 'sheet-abc-123',
        sheetName: 'DoanhThuQ4',
      });

      expect(res.isError).toBe(false);
      const data = parse(res);
      expect(data).toMatchObject({
        spreadsheetId: 'sheet-abc-123',
        activeSheetName: 'DoanhThuQ4',
        headers: ['Mã Đơn', 'Khách Hàng', 'Doanh Thu', 'Thuế VAT', 'Tổng Tiền'],
        firstEmptyRowIndex: 2,
        protectedFormulaColumns: expect.arrayContaining([
          expect.objectContaining({ columnIndex: 3, columnLetter: 'D' }),
          expect.objectContaining({ columnIndex: 4, columnLetter: 'E' }),
        ]),
      });
    });

    it('supports snake_case alias arguments (spreadsheet_id, tab)', async () => {
      const res = await tool.execute({
        spreadsheet_id: 'sheet-xyz',
        tab: 'BaoCao',
      });

      expect(res.isError).toBe(false);
      const data = parse(res);
      expect(data.spreadsheetId).toBe('sheet-xyz');
      expect(data.activeSheetName).toBe('BaoCao');
    });
  });

  describe('GoogleSheetsBatchUpdateTool', () => {
    let tool: GoogleSheetsBatchUpdateTool;

    beforeEach(() => {
      tool = new GoogleSheetsBatchUpdateTool(registry, mockTmpManager);
    });

    it('registers itself into NativeToolRegistryService onModuleInit', () => {
      tool.onModuleInit();
      expect(registry.hasTool('batch_update_values')).toBe(true);
      expect(registry.getAllTools().map((t) => t.name)).toContain('batch_update_values');
    });

    it('declares destructive hint in MCP metadata', () => {
      const dto = tool.toMcpToolDto();
      expect(dto.name).toBe('batch_update_values');
      expect(dto.annotations?.destructiveHint).toBe(true);
      expect(dto.authType).toBe('SYSTEM');
    });

    it('returns error when spreadsheetId is missing', async () => {
      const res = await tool.execute({ values: [['A', 'B']] });
      expect(res.isError).toBe(true);
      expect(parse(res)).toMatchObject({
        code: 'INVALID_ARGUMENTS',
        message: 'spreadsheetId là bắt buộc.',
      });
    });

    it('returns error when neither values nor payloadFilePath is provided', async () => {
      const res = await tool.execute({ spreadsheetId: 'sheet-123' });
      expect(res.isError).toBe(true);
      expect(parse(res).message).toContain('Phải cung cấp values');
    });

    it('executes atomic batch update with direct 2D matrix', async () => {
      const matrix = [
        ['ORD-001', 'Nguyen Van A', 500000],
        ['ORD-002', 'Tran Thi B', 750000],
      ];

      const res = await tool.execute({
        spreadsheetId: 'sheet-123',
        range: 'DoanhThu!A2:C3',
        values: matrix,
      });

      expect(res.isError).toBe(false);
      const data = parse(res);
      expect(data).toEqual({
        spreadsheetId: 'sheet-123',
        updatedRange: 'DoanhThu!A2:C3',
        updatedRows: 2,
        updatedColumns: 3,
        updatedCells: 6,
      });
    });

    it('reads 2D matrix from payload file via ArtifactTmpManager when payloadFilePath is provided', async () => {
      const matrix = [
        ['ORD-101', 'Le Van C', 120000],
        ['ORD-102', 'Pham Van D', 340000],
        ['ORD-103', 'Hoang Van E', 560000],
      ];
      mockTmpManager.readJsonFromFile.mockResolvedValue(matrix);

      const res = await tool.execute(
        {
          spreadsheetId: 'sheet-123',
          payloadFilePath: 'output_matrix.json',
          range: 'Sheet1!A2',
        },
        { workspaceId: 'turn-msg-999' },
      );

      expect(mockTmpManager.readJsonFromFile).toHaveBeenCalledWith(
        'turn-msg-999',
        'output_matrix.json',
      );
      expect(res.isError).toBe(false);
      const data = parse(res);
      expect(data).toMatchObject({
        updatedRows: 3,
        updatedColumns: 3,
        updatedCells: 9,
      });
    });

    it('handles ArtifactTmpManager file read error gracefully', async () => {
      mockTmpManager.readJsonFromFile.mockRejectedValue(
        new Error('File not found or corrupted'),
      );

      const res = await tool.execute({
        spreadsheetId: 'sheet-123',
        payloadFilePath: 'missing.json',
      });

      expect(res.isError).toBe(true);
      expect(parse(res).message).toContain('Không thể đọc file dữ liệu: File not found or corrupted');
    });
  });

  describe('createMockSheetsProvider (Mock Integration)', () => {
    it('supports get_sheet_structure in mock provider mode', () => {
      const provider = createMockSheetsProvider();
      const toolNames = provider.tools.map((t) => t.name);
      expect(toolNames).toContain('get_sheet_structure');
      expect(toolNames).toContain('batch_update_values');

      const res = provider.call('get_sheet_structure', {
        spreadsheet_id: 'sheet_prices',
      });
      expect(res.isError).toBe(false);
      const data = JSON.parse(res.content?.[0]?.text ?? '{}');
      expect(data.headers).toEqual(['Sản phẩm', 'Nhà cung cấp', 'Giá nhập', 'Giá đề xuất']);
      expect(data.firstEmptyRowIndex).toBe(6);
    });

    it('supports batch_update_values in mock provider mode', () => {
      const provider = createMockSheetsProvider();
      const res = provider.call('batch_update_values', {
        spreadsheet_id: 'sheet_plan',
        values: [
          ['Vớ thể thao', 50, 'Đã đặt'],
          ['Túi đeo chéo', 25, 'Chờ duyệt'],
        ],
      });

      expect(res.isError).toBe(false);
      const data = JSON.parse(res.content?.[0]?.text ?? '{}');
      expect(data.updatedRows).toBe(2);
      expect(data.updatedColumns).toBe(3);
      expect(data.updatedCells).toBe(6);
    });
  });
});
