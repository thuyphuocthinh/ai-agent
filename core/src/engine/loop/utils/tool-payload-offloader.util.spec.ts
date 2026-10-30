import { tryOffloadPayloadToDisk } from './tool-payload-offloader.util';
import { IArtifactTmpManager, SaveToTmpEnvelopeDto } from '../../../contracts/storage/artifact-tmp.interface';

describe('tryOffloadPayloadToDisk', () => {
  let mockTmpManager: jest.Mocked<IArtifactTmpManager>;

  beforeEach(() => {
    mockTmpManager = {
      getTurnDir: jest.fn().mockReturnValue('/tmp/artifacts/turn-1'),
      saveJsonToFile: jest.fn().mockResolvedValue('/tmp/artifacts/turn-1/source_query_sql.json'),
      readJsonFromFile: jest.fn(),
      cleanTurnDir: jest.fn().mockResolvedValue(undefined),
      cleanExpiredDirs: jest.fn().mockResolvedValue(0),
    };
  });

  it('returns null when tmpManager is undefined', async () => {
    const hugeText = JSON.stringify(new Array(5000).fill({ a: 1 }));
    const result = await tryOffloadPayloadToDisk(
      'query_sql',
      hugeText,
      'turn-1',
      undefined,
      100,
    );
    expect(result).toBeNull();
  });

  it('returns null when payload size is below or equal to threshold', async () => {
    const smallText = JSON.stringify([{ id: 1 }]);
    const result = await tryOffloadPayloadToDisk(
      'query_sql',
      smallText,
      'turn-1',
      mockTmpManager,
      50_000,
    );
    expect(result).toBeNull();
    expect(mockTmpManager.saveJsonToFile).not.toHaveBeenCalled();
  });

  it('returns null when payload exceeds threshold but is not valid JSON', async () => {
    const hugePlainText = 'A'.repeat(60_000);
    const result = await tryOffloadPayloadToDisk(
      'read_logs',
      hugePlainText,
      'turn-1',
      mockTmpManager,
      50_000,
    );
    expect(result).toBeNull();
    expect(mockTmpManager.saveJsonToFile).not.toHaveBeenCalled();
  });

  it('offloads JSON array exceeding threshold and returns lightweight envelope', async () => {
    const records = Array.from({ length: 100 }, (_, i) => ({
      id: i + 1,
      name: `Khách hàng ${i + 1}`,
      revenue: (i + 1) * 1000000,
    }));
    const rawText = JSON.stringify(records);
    expect(rawText.length).toBeGreaterThan(100);

    const result = await tryOffloadPayloadToDisk(
      'sql.query_sales',
      rawText,
      'turn-abc-123',
      mockTmpManager,
      100,
    );

    expect(result).not.toBeNull();
    expect(mockTmpManager.saveJsonToFile).toHaveBeenCalledWith(
      'turn-abc-123',
      'source_sql_query_sales.json',
      records,
    );

    const envelope = JSON.parse(result as string) as SaveToTmpEnvelopeDto;
    expect(envelope).toMatchObject({
      status: 'saved_to_tmp',
      path: '/tmp/artifacts/turn-1/source_query_sql.json',
      recordCount: 100,
      byteSize: rawText.length,
      sample: [records[0], records[1]],
    });
    expect(envelope.note).toContain('Python Compute Sandbox');
  });

  it('handles single JSON object correctly (recordCount=1, sample=[obj])', async () => {
    const singleObj = {
      reportId: 'REP-999',
      metadata: 'M'.repeat(500),
    };
    const rawText = JSON.stringify(singleObj);

    const result = await tryOffloadPayloadToDisk(
      'get_report',
      rawText,
      'turn-single',
      mockTmpManager,
      100,
    );

    expect(result).not.toBeNull();
    const envelope = JSON.parse(result as string) as SaveToTmpEnvelopeDto;
    expect(envelope.recordCount).toBe(1);
    expect(envelope.sample).toEqual([singleObj]);
  });
});
