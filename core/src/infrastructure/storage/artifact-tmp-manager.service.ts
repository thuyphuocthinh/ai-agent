import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { IArtifactTmpManager } from '../../contracts/storage/artifact-tmp.interface';

@Injectable()
export class ArtifactTmpManagerService
  implements IArtifactTmpManager, OnModuleDestroy
{
  private readonly logger = new Logger(ArtifactTmpManagerService.name);
  private readonly baseDir: string;
  private cleanupInterval?: NodeJS.Timeout;

  constructor() {
    this.baseDir = path.resolve(
      process.env.ARTIFACTS_DIR ?? path.join(os.tmpdir(), 'agent-artifacts'),
    );
    if (!fs.existsSync(this.baseDir)) {
      fs.mkdirSync(this.baseDir, { recursive: true });
    }

    // Tự động quét dọn file tạm hết hạn mỗi 30 phút
    this.cleanupInterval = setInterval(() => {
      this.cleanExpiredDirs().catch((err) =>
        this.logger.warn(
          `Lỗi dọn dẹp file tạm định kỳ: ${(err as Error).message}`,
        ),
      );
    }, 30 * 60 * 1000);
    this.cleanupInterval.unref();
  }

  onModuleDestroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
  }

  getBaseDir(): string {
    return this.baseDir;
  }

  getTurnDir(turnId: string): string {
    const sanitizedTurnId = this.sanitizeTurnId(turnId);
    const turnDir = path.resolve(this.baseDir, sanitizedTurnId);
    if (!fs.existsSync(turnDir)) {
      fs.mkdirSync(turnDir, { recursive: true });
    }
    return turnDir;
  }

  async saveJsonToFile(
    turnId: string,
    filename: string,
    data: unknown,
  ): Promise<string> {
    const targetPath = this.resolveAndValidateSafePath(turnId, filename);
    const turnDir = path.dirname(targetPath);
    if (!fs.existsSync(turnDir)) {
      await fs.promises.mkdir(turnDir, { recursive: true });
    }
    const content =
      typeof data === 'string' ? data : JSON.stringify(data, null, 2);
    await fs.promises.writeFile(targetPath, content, { encoding: 'utf8' });
    return targetPath;
  }

  async readJsonFromFile<T = unknown>(
    turnId: string,
    filenameOrPath: string,
  ): Promise<T> {
    const targetPath = this.resolveAndValidateSafePath(turnId, filenameOrPath);
    if (!fs.existsSync(targetPath)) {
      throw new Error(`File không tồn tại: ${targetPath}`);
    }
    const raw = await fs.promises.readFile(targetPath, 'utf8');
    return JSON.parse(raw) as T;
  }

  async cleanTurnDir(turnId: string): Promise<void> {
    const sanitizedTurnId = this.sanitizeTurnId(turnId);
    const turnDir = path.resolve(this.baseDir, sanitizedTurnId);
    if (fs.existsSync(turnDir)) {
      await fs.promises.rm(turnDir, { recursive: true, force: true });
    }
  }

  async cleanExpiredDirs(ttlMs: number = 60 * 60 * 1000): Promise<number> {
    if (!fs.existsSync(this.baseDir)) return 0;
    const now = Date.now();
    let cleaned = 0;
    const entries = await fs.promises.readdir(this.baseDir, {
      withFileTypes: true,
    });

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const fullPath = path.join(this.baseDir, entry.name);
      try {
        const stats = await fs.promises.stat(fullPath);
        if (now - stats.mtimeMs > ttlMs) {
          await fs.promises.rm(fullPath, { recursive: true, force: true });
          cleaned++;
        }
      } catch (err) {
        this.logger.warn(
          `Không thể xóa thư mục tạm ${fullPath}: ${(err as Error).message}`,
        );
      }
    }
    return cleaned;
  }

  /**
   * BẢO VỆ CHỐNG PATH TRAVERSAL (DEFENSE-IN-DEPTH)
   * Ngăn chặn tuyệt đối các chuỗi "../" hoặc symlink vượt ngoài thư mục turn chỉ định.
   */
  private resolveAndValidateSafePath(
    turnId: string,
    filenameOrPath: string,
  ): string {
    const sanitizedTurnId = this.sanitizeTurnId(turnId);
    const baseTurnDir = path.resolve(this.baseDir, sanitizedTurnId);

    if (
      !filenameOrPath ||
      filenameOrPath.includes('..') ||
      filenameOrPath.trim() === ''
    ) {
      throw new Error(
        `[BẢO MẬT] Tên file không hợp lệ: "${filenameOrPath}". Không được chứa ký tự điều hướng thư mục.`,
      );
    }

    let cleanPath = filenameOrPath.trim();
    const normalizedSlashPath = cleanPath.replace(/\\/g, '/');

    // Chuẩn hóa đường dẫn Linux Container dạng /tmp/artifacts/... -> map an toàn vào this.baseDir
    if (normalizedSlashPath.startsWith('/tmp/artifacts/')) {
      const subPath = normalizedSlashPath.slice('/tmp/artifacts/'.length);
      const resolvedFromBase = path.resolve(this.baseDir, subPath);
      if (!resolvedFromBase.startsWith(this.baseDir + path.sep)) {
        throw new Error(
          `[BẢO MẬT] Phát hiện tấn công Path Traversal: Đường dẫn container "${filenameOrPath}" vượt ngoài phạm vi "${this.baseDir}"`,
        );
      }
      return resolvedFromBase;
    }

    const resolvedPath = path.isAbsolute(cleanPath)
      ? path.resolve(cleanPath)
      : path.resolve(baseTurnDir, cleanPath);

    if (
      !resolvedPath.startsWith(baseTurnDir + path.sep) &&
      !resolvedPath.startsWith(this.baseDir + path.sep)
    ) {
      throw new Error(
        `[BẢO MẬT] Phát hiện tấn công Path Traversal: Đường dẫn "${filenameOrPath}" vượt ngoài phạm vi "${baseTurnDir}"`,
      );
    }
    return resolvedPath;
  }

  private sanitizeTurnId(turnId: string): string {
    if (!turnId || !/^[a-zA-Z0-9_-]+$/.test(turnId)) {
      throw new Error(
        `turnId không hợp lệ: "${turnId}". Chỉ cho phép chữ, số, gạch nối và gạch dưới.`,
      );
    }
    return turnId;
  }
}
