import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { pipeline } from 'stream/promises';
import { Readable } from 'stream';
import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import {
  IStorageService,
  PresignedUrlOptions,
  PresignedUrlResult,
  IStoredBinaryFile,
} from '../../contracts/storage/storage.interface';

/**
 * Tra cứu MIME type từ đuôi mở rộng phổ biến
 */
const COMMON_MIME_TYPES: Readonly<Record<string, string>> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  svg: 'image/svg+xml',
  pdf: 'application/pdf',
  json: 'application/json',
  txt: 'text/plain',
};

@Injectable()
export class DiskStorageService implements IStorageService {
  private readonly logger = new Logger(DiskStorageService.name);
  private readonly baseDir: string;

  constructor() {
    this.baseDir = path.resolve(
      process.env.LOCAL_STORAGE_DIR ?? path.join(process.cwd(), 'data', 'storage'),
    );
    this.ensureDirectoryExists(this.baseDir);
  }

  async createPresignedUploadUrl(options: PresignedUrlOptions): Promise<PresignedUrlResult> {
    const ext = this.extractExtension(options.filename);
    const folder = options.folder ?? 'attachments';
    const key = `${folder}/${crypto.randomUUID()}.${ext}`;
    const expiresInSeconds = options.expiresInSeconds ?? 900;

    const port = process.env.PORT ?? '3000';
    const host = process.env.APP_HOST ?? `http://localhost:${port}`;
    const localUrl = `${host}/api/storage/local/${key}`;

    return {
      uploadUrl: localUrl,
      publicUrl: localUrl,
      key,
      expiresInSeconds,
    };
  }

  async saveStream(
    key: string,
    stream: AsyncIterable<Buffer | string>,
    contentType: string,
  ): Promise<{ status: string; key: string }> {
    const targetPath = this.resolveSafePath(key);
    this.ensureDirectoryExists(path.dirname(targetPath));

    // Chuyển AsyncIterable thành Node.js Readable stream và pipe trực tiếp vào file
    const readable = Readable.from(stream);
    const writeStream = fs.createWriteStream(targetPath);

    try {
      await pipeline(readable, writeStream);
      this.logger.debug(`Đã lưu file thành công: ${key} -> ${targetPath}`);
      return { status: 'success', key };
    } catch (error) {
      this.logger.error(`Lỗi khi ghi file ${key}: ${(error as Error).message}`);
      throw error;
    }
  }

  async getFile(key: string): Promise<IStoredBinaryFile> {
    const targetPath = this.resolveSafePath(key);

    try {
      await fs.promises.access(targetPath, fs.constants.R_OK);
    } catch {
      throw new NotFoundException(`File không tồn tại: ${key}`);
    }

    const buffer = await fs.promises.readFile(targetPath);
    const ext = this.extractExtension(key);
    const contentType = COMMON_MIME_TYPES[ext] ?? 'application/octet-stream';

    return {
      buffer,
      contentType,
    };
  }

  /**
   * Xác thực và phân giải đường dẫn an toàn, ngăn chặn tấn công Path Traversal
   */
  private resolveSafePath(key: string): string {
    const resolved = path.resolve(this.baseDir, key);
    const relative = path.relative(this.baseDir, resolved);

    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new BadRequestException(`Đường dẫn tệp không hợp lệ: ${key}`);
    }

    return resolved;
  }

  private extractExtension(filename: string): string {
    const ext = path.extname(filename).replace('.', '').toLowerCase();
    return ext || 'png';
  }

  private ensureDirectoryExists(dirPath: string): void {
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }
  }
}
