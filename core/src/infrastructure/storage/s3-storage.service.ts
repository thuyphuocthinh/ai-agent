import * as crypto from 'crypto';
import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import {
  IStorageService,
  PresignedUrlOptions,
  PresignedUrlResult,
  IStoredBinaryFile,
} from '../../contracts/storage/storage.interface';

@Injectable()
export class S3StorageService implements IStorageService {
  private readonly logger = new Logger(S3StorageService.name);
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly publicDomain?: string;

  constructor() {
    this.bucket = process.env.S3_BUCKET ?? 'agent-attachments';
    this.publicDomain = process.env.S3_PUBLIC_DOMAIN;

    this.client = new S3Client({
      region: process.env.S3_REGION ?? 'us-east-1',
      endpoint: process.env.S3_ENDPOINT,
      credentials: {
        accessKeyId: process.env.S3_ACCESS_KEY_ID ?? '',
        secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? '',
      },
      forcePathStyle: Boolean(process.env.S3_FORCE_PATH_STYLE ?? process.env.S3_ENDPOINT),
    });
  }

  async createPresignedUploadUrl(options: PresignedUrlOptions): Promise<PresignedUrlResult> {
    const ext = options.filename.includes('.') ? options.filename.split('.').pop() : 'png';
    const folder = options.folder ?? 'attachments';
    const key = `${folder}/${crypto.randomUUID()}.${ext}`;
    const expiresInSeconds = options.expiresInSeconds ?? 900;

    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ContentType: options.contentType,
    });

    const uploadUrl = await getSignedUrl(this.client, command, {
      expiresIn: expiresInSeconds,
    });

    const publicUrl = this.publicDomain
      ? `${this.publicDomain.replace(/\/$/, '')}/${key}`
      : uploadUrl.split('?')[0];

    return {
      uploadUrl,
      publicUrl,
      key,
      expiresInSeconds,
    };
  }

  async saveStream(
    _key: string,
    _stream: AsyncIterable<Buffer | string>,
    _contentType: string,
  ): Promise<{ status: string; key: string }> {
    throw new BadRequestException('Cloud S3 không hỗ trợ streaming tải file trực tiếp qua server');
  }

  async getFile(_key: string): Promise<IStoredBinaryFile> {
    throw new BadRequestException('Cloud S3 không hỗ trợ đọc file nội bộ qua server');
  }
}
