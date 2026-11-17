import { NotFoundException } from '@nestjs/common';
import { LocalStorageService } from './local-storage.service';

describe('LocalStorageService', () => {
  let service: LocalStorageService;

  beforeEach(() => {
    service = new LocalStorageService();
  });

  it('sinh presigned URL nội bộ phục vụ local development', async () => {
    const result = await service.createPresignedUploadUrl({
      filename: 'receipt.png',
      contentType: 'image/png',
    });

    expect(result.uploadUrl).toContain('/api/storage/local/attachments/');
    expect(result.publicUrl).toContain('/api/storage/local/attachments/');
    expect(result.key).toMatch(/^attachments\/[0-9a-f-]+\.png$/);
    expect(result.expiresInSeconds).toBe(900);
  });

  it('lưu stream dữ liệu và đọc lại chính xác', async () => {
    const sampleBuffer = Buffer.from('hello-binary-data');
    const mockStream = {
      async *[Symbol.asyncIterator]() {
        yield sampleBuffer;
      },
    };

    const saveResult = await service.saveStream('attachments/test.png', mockStream, 'image/png');
    expect(saveResult.status).toBe('success');
    expect(saveResult.key).toBe('attachments/test.png');

    const file = await service.getFile('attachments/test.png');
    expect(file.contentType).toBe('image/png');
    expect(file.buffer.equals(sampleBuffer)).toBe(true);
  });

  it('ném NotFoundException khi đọc file không tồn tại', async () => {
    await expect(service.getFile('attachments/non-existent.png')).rejects.toThrow(
      NotFoundException,
    );
  });
});
