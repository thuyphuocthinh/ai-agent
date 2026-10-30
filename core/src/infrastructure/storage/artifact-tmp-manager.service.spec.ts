import { ArtifactTmpManagerService } from './artifact-tmp-manager.service';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('ArtifactTmpManagerService', () => {
  let service: ArtifactTmpManagerService;
  let testBaseDir: string;

  beforeEach(() => {
    testBaseDir = path.join(
      os.tmpdir(),
      `test-artifacts-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    process.env.ARTIFACTS_DIR = testBaseDir;
    service = new ArtifactTmpManagerService();
  });

  afterEach(async () => {
    service.onModuleDestroy();
    delete process.env.ARTIFACTS_DIR;
    if (fs.existsSync(testBaseDir)) {
      await fs.promises.rm(testBaseDir, { recursive: true, force: true });
    }
  });

  describe('getTurnDir', () => {
    it('creates turn directory inside baseDir with sanitized turnId', () => {
      const turnDir = service.getTurnDir('reply-msg-101');
      expect(fs.existsSync(turnDir)).toBe(true);
      expect(turnDir).toBe(path.join(testBaseDir, 'reply-msg-101'));
    });

    it('throws error when turnId contains illegal characters', () => {
      expect(() => service.getTurnDir('../../etc/passwd')).toThrow(
        /turnId không hợp lệ/,
      );
      expect(() => service.getTurnDir('')).toThrow(/turnId không hợp lệ/);
    });
  });

  describe('saveJsonToFile and readJsonFromFile', () => {
    it('saves data as formatted JSON and reads it back accurately', async () => {
      const turnId = 'turn-test-1';
      const sampleData = {
        orders: [
          { id: 'ORD-1', amount: 50000 },
          { id: 'ORD-2', amount: 150000 },
        ],
        total: 200000,
      };

      const savedPath = await service.saveJsonToFile(
        turnId,
        'orders.json',
        sampleData,
      );
      expect(fs.existsSync(savedPath)).toBe(true);

      const loaded = await service.readJsonFromFile<typeof sampleData>(
        turnId,
        'orders.json',
      );
      expect(loaded).toEqual(sampleData);
    });

    it('accepts raw string JSON and saves it correctly', async () => {
      const turnId = 'turn-test-2';
      const rawString = JSON.stringify([{ a: 1 }, { b: 2 }]);

      const savedPath = await service.saveJsonToFile(
        turnId,
        'raw.json',
        rawString,
      );
      const loaded = await service.readJsonFromFile<Array<{ a?: number; b?: number }>>(
        turnId,
        savedPath,
      );
      expect(loaded).toEqual([{ a: 1 }, { b: 2 }]);
    });

    it('throws when reading non-existent file', async () => {
      await expect(
        service.readJsonFromFile('turn-test-3', 'missing.json'),
      ).rejects.toThrow(/File không tồn tại/);
    });
  });

  describe('Path Traversal Guard', () => {
    it('throws error on relative traversal ../ in filename', async () => {
      const turnId = 'turn-attack';
      await expect(
        service.saveJsonToFile(turnId, '../escape.json', { evil: true }),
      ).rejects.toThrow(/Không được chứa ký tự điều hướng thư mục/);
    });

    it('throws error on nested traversal ../../ in filename', async () => {
      const turnId = 'turn-attack-2';
      await expect(
        service.readJsonFromFile(turnId, '../../../../etc/hosts'),
      ).rejects.toThrow(/Không được chứa ký tự điều hướng thư mục/);
    });
  });

  describe('cleanTurnDir and cleanExpiredDirs', () => {
    it('removes turn directory completely', async () => {
      const turnId = 'turn-cleanup';
      await service.saveJsonToFile(turnId, 'test.json', { a: 1 });
      const turnDir = service.getTurnDir(turnId);
      expect(fs.existsSync(turnDir)).toBe(true);

      await service.cleanTurnDir(turnId);
      expect(fs.existsSync(turnDir)).toBe(false);
    });

    it('cleans only expired directories older than TTL', async () => {
      const oldTurnDir = service.getTurnDir('turn-old');
      const newTurnDir = service.getTurnDir('turn-new');

      // Set mtime of oldTurnDir to 2 hours ago
      const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
      fs.utimesSync(oldTurnDir, twoHoursAgo, twoHoursAgo);

      const cleanedCount = await service.cleanExpiredDirs(60 * 60 * 1000); // 1 hour TTL
      expect(cleanedCount).toBe(1);
      expect(fs.existsSync(oldTurnDir)).toBe(false);
      expect(fs.existsSync(newTurnDir)).toBe(true);
    });
  });
});
