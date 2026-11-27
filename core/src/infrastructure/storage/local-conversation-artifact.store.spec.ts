import { BadRequestException, NotFoundException } from '@nestjs/common';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import {
  CONV_ARTIFACT_DIR_NAME,
  ORCHESTRATION_CONSTANTS,
} from '@agent/core/constants';
import { LocalConversationArtifactStore } from './local-conversation-artifact.store';

describe('LocalConversationArtifactStore', () => {
  const store = new LocalConversationArtifactStore();
  const rootDir = path.join(os.tmpdir(), CONV_ARTIFACT_DIR_NAME);
  const createdConvIds: string[] = [];

  const uniqueConvId = (prefix: string): string => {
    const id = `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    createdConvIds.push(id);
    return id;
  };

  afterEach(async () => {
    for (const id of createdConvIds.splice(0)) {
      await fs.rm(path.join(rootDir, id), { recursive: true, force: true });
    }
  });

  afterAll(() => {
    store.onModuleDestroy();
  });

  it('saves and reads back JSON array artifacts with capped sample', async () => {
    const convId = uniqueConvId('json-conv');
    const payload = JSON.stringify([{ id: 1 }, { id: 2 }, { id: 3 }]);

    const record = await store.save({
      conversationId: convId,
      sourceTool: 'sql_server:read_query',
      rawText: payload,
    });

    expect(record.filename).toMatch(/^artifact_.*\.json$/);
    expect(record.mimeType).toBe('application/json');
    expect(record.recordCount).toBe(3);
    expect(record.sample).toHaveLength(
      ORCHESTRATION_CONSTANTS.ARTIFACT_JSON_SAMPLE_COUNT,
    );
    expect(await store.read(convId, record.filename)).toBe(payload);
  });

  it('saves and reads back plain text / CSV artifacts with preview lines', async () => {
    const convId = uniqueConvId('txt-conv');
    const rawCsv = ['col1,col2', 'a,1', 'b,2', 'c,3', 'd,4', 'e,5', 'f,6'].join(
      '\n',
    );

    const record = await store.save({
      conversationId: convId,
      sourceTool: 'report_export',
      rawText: rawCsv,
    });

    expect(record.filename).toMatch(/^artifact_.*\.txt$/);
    expect(record.mimeType).toBe('text/plain');
    expect(record.recordCount).toBe(7);
    expect(record.sample).toHaveLength(
      ORCHESTRATION_CONSTANTS.ARTIFACT_TEXT_PREVIEW_LINES,
    );
    expect(await store.read(convId, record.filename)).toBe(rawCsv);
  });

  it('isolates artifacts by conversationId and throws NotFoundException for missing files', async () => {
    const convA = uniqueConvId('conv-a');
    const convB = uniqueConvId('conv-b');
    const saved = await store.save({
      conversationId: convA,
      sourceTool: 'tool_a',
      rawText: '{"ok":true}',
    });

    await expect(store.read(convB, saved.filename)).rejects.toThrow(
      NotFoundException,
    );
  });

  it('rejects path traversal segments with BadRequestException', async () => {
    await expect(
      store.read('../escape', 'artifact_123.json'),
    ).rejects.toThrow(BadRequestException);
    await expect(
      store.save({
        conversationId: 'conv-valid',
        sourceTool: 'tool',
        rawText: 'hi',
      }),
    ).resolves.toBeDefined();
    createdConvIds.push('conv-valid');
    await expect(store.read('conv-valid', '../secret')).rejects.toThrow(
      BadRequestException,
    );
  });

  it('cleanExpired removes expired artifact files and empty conversation dirs', async () => {
    const expiredConv = uniqueConvId('expired-conv');
    const freshConv = uniqueConvId('fresh-conv');

    const oldRec = await store.save({
      conversationId: expiredConv,
      sourceTool: 'old_tool',
      rawText: 'old payload',
    });
    const freshRec = await store.save({
      conversationId: freshConv,
      sourceTool: 'fresh_tool',
      rawText: 'fresh payload',
    });

    const oldFilePath = path.join(rootDir, expiredConv, oldRec.filename);
    const oldTime = new Date(Date.now() - 10_000);
    await fs.utimes(oldFilePath, oldTime, oldTime);

    const deleted = await store.cleanExpired(5_000);
    expect(deleted).toBeGreaterThanOrEqual(1);
    await expect(store.read(expiredConv, oldRec.filename)).rejects.toThrow(
      NotFoundException,
    );
    expect(await store.read(freshConv, freshRec.filename)).toBe('fresh payload');
  });
});
