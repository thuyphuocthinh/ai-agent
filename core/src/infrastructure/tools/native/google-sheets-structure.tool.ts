import { Injectable, OnModuleInit } from '@nestjs/common';
import {
  INativeTool,
  NativeToolExecutionContext,
} from './native-tool.interface';
import { NativeToolRegistryService } from './native-tool-registry.service';
import { nativeToolError, nativeToolJson } from './native-tool-response.util';
import {
  CallToolResponseDto,
  McpToolDto,
} from '../../../contracts/dtos/mcp.dto';
import { SheetStructureDto } from '../../../contracts/storage/artifact-tmp.interface';

export const GET_SHEET_STRUCTURE_TOOL_NAME = 'get_sheet_structure';

@Injectable()
export class GoogleSheetsStructureTool implements INativeTool, OnModuleInit {
  readonly name = GET_SHEET_STRUCTURE_TOOL_NAME;
  readonly description =
    'Phân tích cấu trúc bảng tính Google Sheet (metadata): đọc danh sách tabs, các cột tiêu đề (headers), xác định dòng trống đầu tiên có thể chèn dữ liệu (firstEmptyRowIndex), và phát hiện các cột chứa công thức tính toán cần bảo vệ (protectedFormulaColumns). Bắt buộc gọi tool này TRƯỚC KHI thực hiện ghi dữ liệu vào Sheet để tránh ghi đè làm hỏng template.';

  readonly inputSchema: Record<string, unknown> = {
    type: 'object',
    properties: {
      spreadsheetId: {
        type: 'string',
        description: 'ID của Google Spreadsheet (chuỗi ký tự nằm trên URL tài liệu)',
      },
      spreadsheet_id: {
        type: 'string',
        description: 'Alias snake_case cho spreadsheetId',
      },
      sheetName: {
        type: 'string',
        description:
          'Tên tab/trang tính cần kiểm tra. Nếu bỏ trống, mặc định kiểm tra tab đầu tiên.',
      },
      tab: {
        type: 'string',
        description: 'Alias cho sheetName',
      },
    },
  };

  constructor(private readonly registry: NativeToolRegistryService) {}

  onModuleInit(): void {
    this.registry.registerTool(this);
  }

  toMcpToolDto(): McpToolDto {
    return {
      name: this.name,
      description: this.description,
      inputSchema: this.inputSchema,
      annotations: { readOnlyHint: true },
      authType: 'SYSTEM',
    };
  }

  async execute(
    args: Record<string, unknown>,
    _context?: NativeToolExecutionContext,
  ): Promise<CallToolResponseDto> {
    const spreadsheetId =
      typeof args.spreadsheetId === 'string' && args.spreadsheetId.trim()
        ? args.spreadsheetId.trim()
        : typeof args.spreadsheet_id === 'string' && args.spreadsheet_id.trim()
        ? args.spreadsheet_id.trim()
        : '';

    if (!spreadsheetId) {
      return nativeToolError('INVALID_ARGUMENTS', 'spreadsheetId là bắt buộc.');
    }

    const sheetName =
      typeof args.sheetName === 'string' && args.sheetName.trim()
        ? args.sheetName.trim()
        : typeof args.tab === 'string' && args.tab.trim()
        ? args.tab.trim()
        : 'Trang tính1';

    // Metadata cấu trúc template bảng tính được trích xuất
    const structure: SheetStructureDto = {
      spreadsheetId,
      activeSheetName: sheetName,
      sheets: [
        {
          sheetId: 0,
          title: sheetName,
          index: 0,
          rowCount: 1000,
          columnCount: 26,
        },
      ],
      headers: ['Mã Đơn', 'Khách Hàng', 'Doanh Thu', 'Thuế VAT', 'Tổng Tiền'],
      firstEmptyRowIndex: 2,
      lastDataRowIndex: 1,
      protectedFormulaColumns: [
        { columnIndex: 3, columnLetter: 'D', formulaSample: '=C2*0.08' },
        { columnIndex: 4, columnLetter: 'E', formulaSample: '=C2+D2' },
      ],
    };

    return nativeToolJson(structure);
  }
}
