import { ActionSummaryAdapter, ActionSummaryContext } from '../action-summary.interface';
import {
  EWriteQueryCountKind,
  EWriteQueryTargetKind,
  extractWriteQueryPreviewTarget,
} from '../../../engine/loop/write-query-preview.util';

export class SqlSummaryAdapter implements ActionSummaryAdapter {
  readonly priority = 100;

  supports(context: ActionSummaryContext): boolean {
    const isSqlProvider = context.provider === 'sql_server';
    const hasSqlName = /sql|database|query/i.test(context.toolName);
    return isSqlProvider || hasSqlName;
  }

  format(context: ActionSummaryContext): string {
    const args = context.args ?? {};
    const normTool = context.toolName.toLowerCase();

    // 1. Tra cứu cấu trúc bảng
    if (normTool.includes('table_schema') || normTool.includes('schema')) {
      const table = (args.table_name || args.table || args.name || '') as string;
      return table
        ? `Tra cứu cấu trúc bảng "${table}"`
        : 'Tra cứu cấu trúc cơ sở dữ liệu';
    }

    const query = typeof args.query === 'string' ? args.query.trim() : '';
    if (!query) {
      return 'Truy vấn cơ sở dữ liệu';
    }

    // 2. Phân tích câu lệnh ghi (UPDATE / INSERT / DELETE / TRUNCATE / DROP)
    const writeTarget = extractWriteQueryPreviewTarget(query);
    if (writeTarget) {
      switch (writeTarget.kind) {
        case EWriteQueryTargetKind.EXISTING_ROWS: {
          const isUpdate = /^UPDATE\b/i.test(query);
          const action = isUpdate ? 'Cập nhật dữ liệu bảng' : 'Xóa dữ liệu bảng';
          return writeTarget.whereClause
            ? `${action} "${writeTarget.table}" (điều kiện: ${writeTarget.whereClause})`
            : `${action} "${writeTarget.table}"`;
        }
        case EWriteQueryTargetKind.INSERT_ROWS: {
          const countStr =
            writeTarget.countKind === EWriteQueryCountKind.MAXIMUM
              ? `tối đa ${writeTarget.rowCount}`
              : `${writeTarget.rowCount}`;
          return `Thêm mới ${countStr} dòng vào bảng "${writeTarget.table}"`;
        }
        case EWriteQueryTargetKind.WHOLE_TABLE_DESTRUCTIVE: {
          return `${writeTarget.operation} toàn bộ bảng "${writeTarget.table}"`;
        }
      }
    }

    // 3. Phân tích câu lệnh đọc (SELECT)
    const selectMatch = query.match(/^SELECT\b[\s\S]+?\bFROM\s+([^\s,;()]+)/i);
    if (selectMatch) {
      const table = selectMatch[1].replace(/["`[\]]/g, '');
      return `Tra cứu dữ liệu từ bảng "${table}"`;
    }

    return 'Thực thi truy vấn cơ sở dữ liệu';
  }
}
