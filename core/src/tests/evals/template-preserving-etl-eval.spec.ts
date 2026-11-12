import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { ArtifactTmpManagerService } from '../../infrastructure/storage/artifact-tmp-manager.service';
import { tryOffloadPayloadToDisk } from '../../engine/loop/utils/tool-payload-offloader.util';
import { GoogleSheetsStructureTool } from '../../infrastructure/tools/native/google-sheets-structure.tool';
import { GoogleSheetsBatchUpdateTool } from '../../infrastructure/tools/native/google-sheets-batch-update.tool';
import { NativeToolRegistryService } from '../../infrastructure/tools/native/native-tool-registry.service';
import { DockerPythonSandboxRunner } from '../../infrastructure/tools/mock/docker-python-sandbox.runner';
import {
  SaveToTmpEnvelopeDto,
  SheetStructureDto,
  BatchUpdateValuesResponseDto,
} from '../../contracts/storage/artifact-tmp.interface';

describe('Template-Preserving ETL & Large Data Offloading - End-to-End Evaluation', () => {
  let tmpManager: ArtifactTmpManagerService;
  let registry: NativeToolRegistryService;
  let structureTool: GoogleSheetsStructureTool;
  let batchUpdateTool: GoogleSheetsBatchUpdateTool;
  let dockerRunner: DockerPythonSandboxRunner;

  const testBaseDir = path.resolve('./.tmp/artifacts', `test-etl-eval-${Date.now()}`);
  const turnId = 'turn-eval-etl-888';

  beforeAll(() => {
    process.env.ARTIFACTS_DIR = testBaseDir;
    tmpManager = new ArtifactTmpManagerService();
    registry = new NativeToolRegistryService();
    structureTool = new GoogleSheetsStructureTool(registry);
    batchUpdateTool = new GoogleSheetsBatchUpdateTool(registry, tmpManager);
    dockerRunner = new DockerPythonSandboxRunner(tmpManager);

    structureTool.onModuleInit();
    batchUpdateTool.onModuleInit();
  });

  afterAll(async () => {
    delete process.env.ARTIFACTS_DIR;
    tmpManager.onModuleDestroy();
    if (fs.existsSync(testBaseDir)) {
      await fs.promises.rm(testBaseDir, { recursive: true, force: true });
    }
  });

  it('runs complete 4-step ETL pipeline: Direct-to-Disk -> Inspector -> Sandbox Transform -> Atomic Batch Update', async () => {
    // -------------------------------------------------------------
    // BƯỚC 1: Direct-to-Disk Offloading (Dữ liệu lớn từ SQL/CRM)
    // -------------------------------------------------------------
    const rawRecords = Array.from({ length: 1000 }, (_, i) => ({
      orderId: `ORD-${String(i + 1).padStart(5, '0')}`,
      customerName: `Khách Hàng ${i + 1}`,
      revenue: (i + 1) * 250000,
      createdAt: new Date().toISOString(),
    }));

    const rawJsonText = JSON.stringify(rawRecords);
    expect(rawJsonText.length).toBeGreaterThan(50_000); // ~110KB

    // Van xả Direct-to-Disk offload raw JSON trực tiếp ra đĩa tạm của turn
    const envelopeJson = await tryOffloadPayloadToDisk(
      'query_sql_orders',
      rawJsonText,
      turnId,
      tmpManager,
    );

    expect(envelopeJson).not.toBeNull();
    const envelope = JSON.parse(envelopeJson!) as SaveToTmpEnvelopeDto;
    expect(envelope.status).toBe('saved_to_tmp');
    expect(envelope.recordCount).toBe(1000);
    expect(envelope.byteSize).toBe(rawJsonText.length);
    expect(envelope.sample).toHaveLength(2);
    expect(fs.existsSync(envelope.path)).toBe(true);

    // Xác minh Context Window được tiết kiệm > 99%
    expect(envelopeJson!.length).toBeLessThan(1000);
    expect(envelopeJson!.length).toBeLessThan(rawJsonText.length * 0.01);

    // -------------------------------------------------------------
    // BƯỚC 2: Sheet Template Inspection (Kiểm tra mẫu & cột công thức)
    // -------------------------------------------------------------
    const structureRes = await structureTool.execute({
      spreadsheetId: 'sheet-sales-q4',
      sheetName: 'Báo Cáo Doanh Thu',
    });

    expect(structureRes.isError).toBe(false);
    const structure = JSON.parse(
      structureRes.content?.[0]?.text ?? '{}',
    ) as SheetStructureDto;

    expect(structure.spreadsheetId).toBe('sheet-sales-q4');
    expect(structure.firstEmptyRowIndex).toBe(2);
    expect(structure.headers).toEqual([
      'Mã Đơn',
      'Khách Hàng',
      'Doanh Thu',
      'Thuế VAT',
      'Tổng Tiền',
    ]);
    // Cột 3 (Thuế VAT) và 4 (Tổng Tiền) là cột công thức cần bảo vệ
    expect(structure.protectedFormulaColumns).toHaveLength(2);
    const protectedIndices = structure.protectedFormulaColumns.map(
      (c) => c.columnIndex,
    );
    expect(protectedIndices).toContain(3);
    expect(protectedIndices).toContain(4);

    // -------------------------------------------------------------
    // BƯỚC 3: Python Compute Sandbox Data Transformation
    // -------------------------------------------------------------
    // Agent sinh code Python đọc file source_xxx.json từ thư mục mount /tmp/artifacts/<turnId>/
    // chuẩn hóa và mapping vào các cột dữ liệu [Mã Đơn, Khách Hàng, Doanh Thu],
    // và ghi ra file transformed_orders_matrix.json.
    const sourceFilename = path.basename(envelope.path);
    const transformedFilename = 'transformed_orders_matrix.json';

    const pythonCode = `
import json

source_path = '/tmp/artifacts/${turnId}/${sourceFilename}'
output_path = '/tmp/artifacts/${turnId}/${transformedFilename}'

with open(source_path, 'r', encoding='utf-8') as f:
    records = json.load(f)

# Chỉ trích xuất 3 cột dữ liệu, không ghi đè vào 2 cột công thức (Thuế VAT, Tổng Tiền)
matrix = [[r['orderId'], r['customerName'], r['revenue']] for r in records]

with open(output_path, 'w', encoding='utf-8') as f:
    json.dump(matrix, f)

print(f"Successfully transformed {len(matrix)} rows")
`.trim();

    const dockerResult = await dockerRunner.runPython(pythonCode, turnId);
    expect(dockerResult.success).toBe(true);
    expect(dockerResult.stdout).toContain('Successfully transformed 1000 rows');

    // Xác minh file output thực sự được tạo ra trên đĩa
    const transformedDiskPath = path.join(
      tmpManager.getTurnDir(turnId),
      transformedFilename,
    );
    expect(fs.existsSync(transformedDiskPath)).toBe(true);

    const transformedData = await tmpManager.readJsonFromFile<unknown[][]>(
      turnId,
      transformedFilename,
    );
    expect(transformedData).toHaveLength(1000);
    expect(transformedData[0]).toEqual(['ORD-00001', 'Khách Hàng 1', 250000]);

    // -------------------------------------------------------------
    // BƯỚC 4: Atomic Batch Update (Ghi nguyên tử trong 1 request)
    // -------------------------------------------------------------
    const batchUpdateRes = await batchUpdateTool.execute(
      {
        spreadsheetId: structure.spreadsheetId,
        range: `${structure.activeSheetName}!A${structure.firstEmptyRowIndex}`,
        payloadFilePath: transformedFilename,
      },
      { workspaceId: turnId },
    );

    expect(batchUpdateRes.isError).toBe(false);
    const updateResult = JSON.parse(
      batchUpdateRes.content?.[0]?.text ?? '{}',
    ) as BatchUpdateValuesResponseDto;

    expect(updateResult).toEqual({
      spreadsheetId: 'sheet-sales-q4',
      updatedRange: 'Báo Cáo Doanh Thu!A2',
      updatedRows: 1000,
      updatedColumns: 3,
      updatedCells: 3000,
    });

    // -------------------------------------------------------------
    // DỌN DẸP AN TOÀN (Post-Turn Cleanup)
    // -------------------------------------------------------------
    await tmpManager.cleanTurnDir(turnId);
    const turnDir = tmpManager.getTurnDir(turnId);
    const remainingFiles = await fs.promises.readdir(turnDir);
    expect(remainingFiles).toHaveLength(0);
  });

  it('enforces network isolation (--network none) preventing data exfiltration', async () => {
    const maliciousScript = `
import urllib.request
try:
    urllib.request.urlopen("http://1.1.1.1", timeout=2)
    print("LEAK_SUCCESS")
except Exception as e:
    import sys
    sys.stderr.write(f"BLOCKED_NETWORK: {type(e).__name__}: {e}")
    sys.exit(1)
`.trim();

    const result = await dockerRunner.runPython(maliciousScript, turnId);
    expect(result.success).toBe(false);
    expect(result.stdout).not.toContain('LEAK_SUCCESS');
    expect(result.stderr).toContain('BLOCKED_NETWORK');
  });

  it('enforces read-only root filesystem preventing malicious file writes outside /tmp/artifacts', async () => {
    const maliciousScript = `
try:
    with open('/root/escape.txt', 'w') as f:
        f.write('hacked')
    print("WRITE_SUCCESS")
except Exception as e:
    import sys
    sys.stderr.write(f"BLOCKED_FS: {type(e).__name__}: {e}")
    sys.exit(1)
`.trim();

    const result = await dockerRunner.runPython(maliciousScript, turnId);
    expect(result.success).toBe(false);
    expect(result.stdout).not.toContain('WRITE_SUCCESS');
    expect(result.stderr).toMatch(/Read-only file system|Permission denied/);
  });

  it('blocks sandbox escape attempts and path traversal during batch update', async () => {
    const maliciousPaths = [
      '../outside.json',
      '../../etc/passwd',
      '..\\..\\windows\\system32\\cmd.exe',
      'sub/../../escape.json',
    ];

    for (const badPath of maliciousPaths) {
      const res = await batchUpdateTool.execute(
        {
          spreadsheetId: 'sheet-test',
          payloadFilePath: badPath,
        },
        { workspaceId: turnId },
      );

      expect(res.isError).toBe(true);
      const err = JSON.parse(res.content?.[0]?.text ?? '{}');
      expect(err.code).toBe('READ_FAILED');
      expect(err.message).toContain('điều hướng thư mục');
    }
  });
});
