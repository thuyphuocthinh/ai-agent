import sharp = require('sharp');
import { ImagePreprocessorUtil } from './image-preprocessor.util';

describe('ImagePreprocessorUtil', () => {
  it('giữ nguyên ảnh khi kích thước và dung lượng nhỏ hơn ngưỡng trần', async () => {
    // Tạo ảnh nhỏ 100x100
    const smallBuffer = await sharp({
      create: {
        width: 100,
        height: 100,
        channels: 3,
        background: { r: 255, g: 0, b: 0 },
      },
    })
      .jpeg()
      .toBuffer();

    const result = await ImagePreprocessorUtil.preprocess(smallBuffer);

    expect(result.wasProcessed).toBe(false);
    expect(result.width).toBe(100);
    expect(result.height).toBe(100);
    expect(result.mimeType).toBe('image/jpeg');
    expect(result.buffer).toBe(smallBuffer);
  });

  it('tự động downscale ảnh vượt quá maxDimension (giữ aspect ratio)', async () => {
    // Tạo ảnh lớn 2400x1200
    const largeBuffer = await sharp({
      create: {
        width: 2400,
        height: 1200,
        channels: 3,
        background: { r: 0, g: 255, b: 0 },
      },
    })
      .jpeg()
      .toBuffer();

    const result = await ImagePreprocessorUtil.preprocess(largeBuffer, {
      maxDimension: 1200,
    });

    expect(result.wasProcessed).toBe(true);
    expect(result.width).toBe(1200);
    expect(result.height).toBe(600); // 2400x1200 downscale to 1200 max -> 1200x600
    expect(result.mimeType).toBe('image/jpeg');
  });

  it('xử lý đầu vào data URI Base64 an toàn', async () => {
    const rawBuffer = await sharp({
      create: {
        width: 50,
        height: 50,
        channels: 3,
        background: { r: 0, g: 0, b: 255 },
      },
    })
      .png()
      .toBuffer();

    const dataUri = `data:image/png;base64,${rawBuffer.toString('base64')}`;
    const result = await ImagePreprocessorUtil.preprocess(dataUri);

    expect(result.mimeType).toBe('image/png');
    expect(result.width).toBe(50);
    expect(result.height).toBe(50);
  });

  it('fallback an toàn khi buffer hỏng mà không quăng unhandled exception', async () => {
    const corruptedBuffer = Buffer.from('not-a-valid-image-data-string');
    const result = await ImagePreprocessorUtil.preprocess(corruptedBuffer);

    expect(result.wasProcessed).toBe(false);
    expect(result.buffer).toEqual(corruptedBuffer);
  });
});
