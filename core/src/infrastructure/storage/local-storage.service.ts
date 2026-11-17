import * as crypto from 'crypto';
import { Injectable, NotFoundException } from '@nestjs/common';
import {
  IStorageService,
  PresignedUrlOptions,
  PresignedUrlResult,
  IStoredBinaryFile,
} from '../../contracts/storage/storage.interface';

@Injectable()
export class LocalStorageService implements IStorageService {
  private readonly memoryStore = new Map<string, IStoredBinaryFile>();

  async createPresignedUploadUrl(options: PresignedUrlOptions): Promise<PresignedUrlResult> {
    const ext = options.filename.includes('.') ? options.filename.split('.').pop() : 'png';
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
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
    }
    this.memoryStore.set(key, {
      buffer: Buffer.concat(chunks),
      contentType,
    });
    return { status: 'success', key };
  }

  async getFile(key: string): Promise<IStoredBinaryFile> {
    const file = this.memoryStore.get(key);
    if (!file) {
      throw new NotFoundException(`File không tồn tại: ${key}`);
    }
    return file;
  }

  clearMemory(): void {
    this.memoryStore.clear();
  }
}
