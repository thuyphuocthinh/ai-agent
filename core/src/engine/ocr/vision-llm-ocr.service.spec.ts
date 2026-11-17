import { RpcException } from '@nestjs/microservices';
import { VisionLlmOcrService } from './vision-llm-ocr.service';
import { VisionProviderResolver } from './vision-provider.resolver';
import { IVisionLlmProvider } from '../../contracts';
import * as ssrfSafeReader from '../../infrastructure/tools/openapi/ssrf-safe-http-reader.util';
import { IStorageService } from '../../contracts/storage/storage.interface';

describe('VisionLlmOcrService', () => {
  let service: VisionLlmOcrService;
  let mockProvider: jest.Mocked<IVisionLlmProvider>;
  let mockResolver: jest.Mocked<VisionProviderResolver>;

  beforeEach(() => {
    mockProvider = {
      id: 'mock-provider',
      isAvailable: jest.fn().mockReturnValue(true),
      generateText: jest.fn(),
    };

    mockResolver = {
      resolve: jest.fn().mockReturnValue(mockProvider),
    } as unknown as jest.Mocked<VisionProviderResolver>;

    service = new VisionLlmOcrService(mockResolver);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('báo lỗi khi không truyền cả imageUrl lẫn imageBase64', async () => {
    await expect(service.extractText({})).rejects.toThrow(RpcException);
  });

  it('chặn URL độc hại và ném lỗi khi readUrlSafely chặn SSRF', async () => {
    jest.spyOn(ssrfSafeReader, 'readUrlSafely').mockRejectedValue(
      new Error('SSRF blocked: refusing to connect to private address 127.0.0.1'),
    );

    await expect(
      service.extractText({ imageUrl: 'http://127.0.0.1:3000/admin' }),
    ).rejects.toThrow('SSRF blocked');
  });

  it('xử lý thành công ảnh từ Base64 và trích xuất bảng Markdown', async () => {
    const mockMarkdown =
      '# HÓA ĐƠN BÁN HÀNG\n| Mã hàng | Số lượng | Đơn giá |\n|---|---|---|\n| MH01 | 2 | 50.000 |';

    mockProvider.generateText.mockResolvedValue(mockMarkdown);

    const result = await service.extractText({
      imageBase64:
        'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    });

    expect(result.hasText).toBe(true);
    expect(result.detectedDocumentType).toBe('table');
    expect(result.markdown).toContain('| Mã hàng | Số lượng | Đơn giá |');
    expect(result.characterCount).toBe(mockMarkdown.length);
    expect(mockProvider.generateText).toHaveBeenCalledWith(
      expect.objectContaining({
        mimeType: 'image/png',
        base64Data: expect.any(String),
      }),
    );
  });

  it('xử lý chính xác ảnh không có chữ khi Vision trả về [NO_TEXT_DETECTED]', async () => {
    mockProvider.generateText.mockResolvedValue('[NO_TEXT_DETECTED]: Ảnh phong cảnh hoàng hôn');

    const result = await service.extractText({
      imageBase64: 'raw-base64-string',
    });

    expect(result.hasText).toBe(false);
    expect(result.detectedDocumentType).toBe('non_text');
    expect(result.markdown).toBe('Ảnh phong cảnh hoàng hôn');
    expect(result.characterCount).toBe(0);
  });

  it('phân giải ảnh trực tiếp qua IStorageService injected mà không bị chặn SSRF', async () => {
    const mockStorageService: jest.Mocked<IStorageService> = {
      createPresignedUploadUrl: jest.fn(),
      saveStream: jest.fn(),
      getFile: jest.fn().mockResolvedValue({
        buffer: Buffer.from('mock-png-binary'),
        contentType: 'image/png',
      }),
    };

    const serviceWithStorage = new VisionLlmOcrService(mockResolver, mockStorageService);
    mockProvider.generateText.mockResolvedValue('NỘI DUNG LOCAL STORAGE INVOICE');

    const result = await serviceWithStorage.extractText({
      imageUrl: 'http://localhost:3000/api/storage/local/attachments/test-local.png',
    });

    expect(result.hasText).toBe(true);
    expect(result.markdown).toBe('NỘI DUNG LOCAL STORAGE INVOICE');
    expect(mockStorageService.getFile).toHaveBeenCalledWith('attachments/test-local.png');
    expect(mockProvider.generateText).toHaveBeenCalledWith(
      expect.objectContaining({
        mimeType: 'image/png',
        base64Data: Buffer.from('mock-png-binary').toString('base64'),
      }),
    );
  });
});
