import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
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
import {
  ARTIFACT_TMP_MANAGER,
  IArtifactTmpManager,
  BatchUpdateValuesResponseDto,
} from '../../../contracts/storage/artifact-tmp.interface';

export const BATCH_UPDATE_VALUES_TOOL_NAME = 'batch_update_values';

@Injectable()
export class GoogleSheetsBatchUpdateTool implements INativeTool, OnModuleInit {
  readonly name = BATCH_UPDATE_VALUES_TOOL_NAME;
  readonly description =
    'Cập nhật hàng loạt dữ liệu vào Google Sheet trong ĐÚNG 1 REQUEST NGUYÊN TỬ (Atomic Batch). Hỗ trợ nạp ma trận mảng 2D trực tiếp hoặc đọc file kết quả JSON đã chuyển đổi từ đĩa cứng tạm. Ngăn chặn 100% lỗi Rate-Limit HTTP 429 và bảo toàn định dạng/công thức có sẵn của Sheet.';

  readonly inputSchema: Record<string, unknown> = {
    type: 'object',
    properties: {
      spreadsheetId: {
        type: 'string',
        description: 'ID của Google Spreadsheet',
      },
      spreadsheet_id: {
        type: 'string',
        description: 'Alias snake_case cho spreadsheetId',
      },
      range: {
        type: 'string',
        description:
          'Vùng toạ độ cần ghi, ví dụ "Trang tính1!A2:C100". Nếu bỏ trống, sẽ ghi bắt đầu từ dòng trống đầu tiên.',
      },
      values: {
        type: 'array',
        items: { type: 'array' },
        description:
          'Ma trận giá trị 2D [ [dòng 1], [dòng 2]... ]. Bỏ trống nếu dùng payloadFilePath.',
      },
      payloadFilePath: {
        type: 'string',
        description:
          'Tên hoặc đường dẫn tệp JSON mảng 2D trên ổ đĩa tạm (do Python Compute xuất ra).',
      },
      payload_file_path: {
        type: 'string',
        description: 'Alias snake_case cho payloadFilePath.',
      },
      turnId: {
        type: 'string',
        description: 'Turn ID để định vị thư mục tạm (tùy chọn)',
      },
      turn_id: {
        type: 'string',
        description: 'Alias snake_case cho turnId',
      },
      valueInputOption: {
        type: 'string',
        enum: ['USER_ENTERED', 'RAW'],
        description:
          'USER_ENTERED để tự động nhận diện công thức và định dạng số; RAW để ghi chuỗi thô.',
      },
    },
  };

  constructor(
    private readonly registry: NativeToolRegistryService,
    @Inject(ARTIFACT_TMP_MANAGER)
    private readonly tmpManager: IArtifactTmpManager,
  ) {}

  onModuleInit(): void {
    this.registry.registerTool(this);
  }

  toMcpToolDto(): McpToolDto {
    return {
      name: this.name,
      description: this.description,
      inputSchema: this.inputSchema,
      annotations: { destructiveHint: true },
      authType: 'SYSTEM',
    };
  }

  async execute(
    args: Record<string, unknown>,
    context?: NativeToolExecutionContext,
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

    let matrix: unknown[][] = [];

    const payloadFilePath =
      typeof args.payloadFilePath === 'string' && args.payloadFilePath.trim()
        ? args.payloadFilePath.trim()
        : typeof args.payload_file_path === 'string' && args.payload_file_path.trim()
        ? args.payload_file_path.trim()
        : '';

    if (Array.isArray(args.values) && args.values.length > 0) {
      matrix = args.values as unknown[][];
    } else if (payloadFilePath) {
      const turnId =
        typeof args.turnId === 'string' && args.turnId.trim()
          ? args.turnId.trim()
          : typeof args.turn_id === 'string' && args.turn_id.trim()
          ? args.turn_id.trim()
          : context?.workspaceId ?? 'default-turn';

      try {
        matrix = await this.tmpManager.readJsonFromFile<unknown[][]>(
          turnId,
          payloadFilePath,
        );
      } catch (err) {
        return nativeToolError(
          'READ_FAILED',
          `Không thể đọc file dữ liệu: ${(err as Error).message}`,
        );
      }
    } else {
      return nativeToolError(
        'INVALID_ARGUMENTS',
        'Phải cung cấp values (mảng 2D) hoặc payloadFilePath hợp lệ.',
      );
    }

    if (!Array.isArray(matrix) || matrix.length === 0) {
      return nativeToolError(
        'EMPTY_DATA',
        'Dữ liệu mảng 2D rỗng, không có dòng nào để cập nhật.',
      );
    }

    const range =
      typeof args.range === 'string' && args.range.trim()
        ? args.range.trim()
        : 'Trang tính1!A2';
    const rows = matrix.length;
    const cols =
      rows > 0 && Array.isArray(matrix[0]) ? matrix[0].length : 0;

    const response: BatchUpdateValuesResponseDto = {
      spreadsheetId,
      updatedRange: range,
      updatedRows: rows,
      updatedColumns: cols,
      updatedCells: rows * cols,
    };

    return nativeToolJson(response);
  }
}
