import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { DiskStorageService } from './disk-storage.service';

describe('DiskStorageService', () => {
  let service: DiskStorageService;
  let testDir: string;

  beforeEach(() => {
    testDir = path.join(os.tmpdir(), `disk-storage-test-${Date.now()}`);
    process.env.LOCAL_STORAGE_DIR = testDir;
    service = new DiskStorageService();
  });

  afterEach(async () => {
    delete process.env.LOCAL_STORAGE_DIR;
    if (fs.existsSync(testDir)) {
      await fs.promises.rm(testDir, { recursive: true, force: true });
    }
  });

  it('sinh presigned upload URL chuẩn theo cấu trúc folder/uuid.ext', async () => {
    const result = await service.createPresignedUploadUrl({
      filename: 'invoice.pdf',
      contentType: 'application/pdf',
      folder: 'docs',
    });

    expect(result.uploadUrl).toContain('/api/storage/local/docs/');
    expect(result.publicUrl).toContain('/api/storage/local/docs/');
    expect(result.key).toMatch(/^docs\/[0-9a-f-]+\.pdf$/);
    expect(result.expiresInSeconds).toBe(900);
  });

  it('stream dữ liệu trực tiếp vào file vật lý và đọc lại đúng nội dung', async () => {
    const binaryData = Buffer.from('test-binary-stream-payload');
    const asyncIterable = {
      async *[Symbol.asyncIterator]() {
        yield binaryData;
      },
    };

    const saveResult = await service.saveStream('attachments/image.png', asyncIterable, 'image/png');
    expect(saveResult.status).toBe('success');
    expect(saveResult.key).toBe('attachments/image.png');

    // Xác nhận file thực tế đã được ghi xuống ổ đĩa
    const actualFilePath = path.join(testDir, 'attachments', 'image.png');
    expect(fs.existsSync(actualFilePath)).toBe(true);

    const file = await service.getFile('attachments/image.png');
    expect(file.contentType).toBe('image/png');
    expect(file.buffer.equals(binaryData)).toBe(true);
  });

  it('ném NotFoundException khi file không tồn tại', async () => {
    await expect(service.getFile('attachments/not-found.png')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('chặn tấn công Path Traversal bằng BadRequestException', async () => {
    await expect(
      service.getFile('../../secret.env'),
    ).rejects.toThrow(BadRequestException);
  });
});
