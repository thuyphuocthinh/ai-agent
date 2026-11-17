import { S3StorageService } from './s3-storage.service';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { BadRequestException } from '@nestjs/common';

jest.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: jest.fn().mockResolvedValue('https://test-bucket.s3.us-east-1.amazonaws.com/attachments/test-uuid.png?X-Amz-Signature=test'),
}));

describe('S3StorageService', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = {
      ...originalEnv,
      S3_BUCKET: 'test-bucket',
      S3_REGION: 'us-east-1',
      S3_ACCESS_KEY_ID: 'test-key',
      S3_SECRET_ACCESS_KEY: 'test-secret',
    };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('gọi getSignedUrl của AWS SDK và trả về kết quả chuẩn xác', async () => {
    const service = new S3StorageService();
    const result = await service.createPresignedUploadUrl({
      filename: 'invoice.png',
      contentType: 'image/png',
      expiresInSeconds: 600,
    });

    expect(getSignedUrl).toHaveBeenCalled();
    expect(result.uploadUrl).toContain('test-bucket.s3.us-east-1.amazonaws.com');
    expect(result.publicUrl).toBe('https://test-bucket.s3.us-east-1.amazonaws.com/attachments/test-uuid.png');
    expect(result.expiresInSeconds).toBe(600);
    expect(result.key).toMatch(/^attachments\/[0-9a-f-]+\.png$/);
  });

  it('sử dụng S3_PUBLIC_DOMAIN khi được cấu hình', async () => {
    process.env.S3_PUBLIC_DOMAIN = 'https://cdn.mycompany.com';
    const service = new S3StorageService();
    const result = await service.createPresignedUploadUrl({
      filename: 'photo.jpg',
      contentType: 'image/jpeg',
    });

    expect(result.publicUrl).toMatch(/^https:\/\/cdn\.mycompany\.com\/attachments\/[0-9a-f-]+\.jpg$/);
  });

  it('ném BadRequestException khi gọi saveStream hoặc getFile', async () => {
    const service = new S3StorageService();
    const mockStream = {
      async *[Symbol.asyncIterator]() {
        yield Buffer.from('');
      },
    };

    await expect(service.saveStream('key', mockStream, 'image/png')).rejects.toThrow(
      BadRequestException,
    );
    await expect(service.getFile('key')).rejects.toThrow(BadRequestException);
  });
});
