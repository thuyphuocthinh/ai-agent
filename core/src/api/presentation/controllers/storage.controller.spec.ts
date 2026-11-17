import { StorageController } from './storage.controller';
import { IStorageService } from '../../../contracts';
import { BYPASS_TRANSFORM_KEY } from '../decorators/bypass-transform.decorator';
import type { IncomingMessage, ServerResponse } from 'http';

describe('StorageController', () => {
  let controller: StorageController;
  let mockStorageService: jest.Mocked<IStorageService>;

  beforeEach(() => {
    mockStorageService = {
      createPresignedUploadUrl: jest.fn().mockResolvedValue({
        uploadUrl: 'https://storage.example.com/upload/photo.png',
        publicUrl: 'https://storage.example.com/photo.png',
        key: 'attachments/photo.png',
        expiresInSeconds: 900,
      }),
      saveStream: jest.fn().mockResolvedValue({
        status: 'success',
        key: 'attachments/local-test.png',
      }),
      getFile: jest.fn().mockResolvedValue({
        buffer: Buffer.from('fake-image-bytes'),
        contentType: 'image/png',
      }),
    };

    controller = new StorageController(mockStorageService);
  });

  it('gọi storageService.createPresignedUploadUrl với DTO hợp lệ', async () => {
    const dto = {
      filename: 'photo.png',
      contentType: 'image/png',
      expiresInSeconds: 600,
    };

    const result = await controller.createPresignedUrl(dto);

    expect(mockStorageService.createPresignedUploadUrl).toHaveBeenCalledWith(dto);
    expect(result.uploadUrl).toBe('https://storage.example.com/upload/photo.png');
    expect(result.publicUrl).toBe('https://storage.example.com/photo.png');
  });

  it('ủy quyền lưu stream cho storageService.saveStream với params chuẩn', async () => {
    const mockPutReq = {} as unknown as IncomingMessage;

    const putResult = await controller.uploadLocalFile(
      'attachments',
      'local-test.png',
      'image/png',
      mockPutReq,
    );

    expect(mockStorageService.saveStream).toHaveBeenCalledWith(
      'attachments/local-test.png',
      mockPutReq,
      'image/png',
    );
    expect(putResult.status).toBe('success');
    expect(putResult.key).toBe('attachments/local-test.png');
  });

  it('ủy quyền đọc file cho storageService.getFile và trả về StreamableFile', async () => {
    const mockRes = {
      setHeader: jest.fn(),
    } as unknown as ServerResponse;

    const streamable = await controller.getLocalFile('attachments', 'local-test.png', mockRes);

    expect(mockStorageService.getFile).toHaveBeenCalledWith('attachments/local-test.png');
    expect(mockRes.setHeader).toHaveBeenCalledWith('Content-Type', 'image/png');
    expect(streamable.getStream()).toBeDefined();
  });

  it('phải gắn decorator @BypassTransform() trên getLocalFile để tránh bị bọc JSON', () => {
    const isBypass = Reflect.getMetadata(BYPASS_TRANSFORM_KEY, controller.getLocalFile);
    expect(isBypass).toBe(true);
  });
});
