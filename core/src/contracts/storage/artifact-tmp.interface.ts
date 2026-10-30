export interface SaveToTmpEnvelopeDto {
  status: 'saved_to_tmp';
  path: string;
  recordCount: number;
  byteSize: number;
  sample: unknown[];
  note: string;
}

export interface SheetTabMetadataDto {
  sheetId: number;
  title: string;
  index: number;
  rowCount: number;
  columnCount: number;
}

export interface ProtectedFormulaColumnDto {
  columnIndex: number; // 0-based
  columnLetter: string; // "A", "B", "C"...
  formulaSample: string; // "=SUM(C2:C10)"
}

export interface SheetStructureDto {
  spreadsheetId: string;
  activeSheetName: string;
  sheets: SheetTabMetadataDto[];
  headers: string[];
  firstEmptyRowIndex: number; // 1-based (dòng trống đầu tiên để chèn)
  lastDataRowIndex: number;
  protectedFormulaColumns: ProtectedFormulaColumnDto[];
}

export interface BatchUpdateValuesRequestDto {
  spreadsheetId: string;
  range?: string; // Ví dụ: "Sheet1!A3:D"
  values?: (string | number | boolean | null)[][];
  payloadFilePath?: string; // Đường dẫn an toàn tới file JSON chứa mảng 2D
  valueInputOption?: 'USER_ENTERED' | 'RAW';
}

export interface BatchUpdateValuesResponseDto {
  spreadsheetId: string;
  updatedRange: string;
  updatedRows: number;
  updatedColumns: number;
  updatedCells: number;
}

export interface IArtifactTmpManager {
  getTurnDir(turnId: string): string;
  saveJsonToFile(turnId: string, filename: string, data: unknown): Promise<string>;
  readJsonFromFile<T = unknown>(turnId: string, filenameOrPath: string): Promise<T>;
  cleanTurnDir(turnId: string): Promise<void>;
  cleanExpiredDirs(ttlMs?: number): Promise<number>;
}

export const ARTIFACT_TMP_MANAGER = Symbol.for('ARTIFACT_TMP_MANAGER');
