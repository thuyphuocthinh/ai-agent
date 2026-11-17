export const STORAGE_SERVICE = Symbol.for('STORAGE_SERVICE');

export interface PresignedUrlOptions {
  filename: string;
  contentType: string;
  folder?: string;
  expiresInSeconds?: number;
}

export interface PresignedUrlResult {
  uploadUrl: string;
  publicUrl: string;
  key: string;
  expiresInSeconds: number;
}

export interface IMessageAttachment {
  type: 'image' | 'file';
  url: string;
  name?: string;
  size?: number;
  mimeType?: string;
}

export interface IStoredBinaryFile {
  buffer: Buffer;
  contentType: string;
}

export interface IStorageService {
  createPresignedUploadUrl(options: PresignedUrlOptions): Promise<PresignedUrlResult>;
  saveStream(
    key: string,
    stream: AsyncIterable<Buffer | string>,
    contentType: string,
  ): Promise<{ status: string; key: string }>;
  getFile(key: string): Promise<IStoredBinaryFile>;
}
