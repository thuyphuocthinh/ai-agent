import sharp = require('sharp');
import {
  ImagePreprocessOptions,
  PreprocessedImageResult,
} from '../../contracts';

export class ImagePreprocessorUtil {
  public static readonly MAX_DIMENSION = 1920;
  public static readonly JPEG_QUALITY = 85;
  public static readonly SIZE_THRESHOLD = 500 * 1024; // 500 KB

  /**
   * Tiền xử lý ảnh: downscale khi kích thước vượt quá 1920px (giữ aspect ratio)
   * và nén JPEG 85% để tối ưu hóa payload/token mà bảo toàn độ sắc nét ký tự văn bản.
   */
  public static async preprocess(
    input: Buffer | string,
    options?: ImagePreprocessOptions,
  ): Promise<PreprocessedImageResult> {
    const { buffer, mimeType } = this.parseInput(input);
    const maxDimension = options?.maxDimension ?? this.MAX_DIMENSION;
    const quality = options?.quality ?? this.JPEG_QUALITY;
    const sizeThreshold = options?.sizeThresholdBytes ?? this.SIZE_THRESHOLD;

    try {
      const meta = await sharp(buffer).metadata();
      const width = meta.width ?? 0;
      const height = meta.height ?? 0;

      const needsResize = width > maxDimension || height > maxDimension;
      const needsCompression = buffer.length > sizeThreshold;

      if (!needsResize && !needsCompression) {
        return {
          buffer,
          mimeType,
          base64Data: buffer.toString('base64'),
          width,
          height,
          wasProcessed: false,
        };
      }

      let pipeline = sharp(buffer);
      if (needsResize) {
        pipeline = pipeline.resize({
          width: maxDimension,
          height: maxDimension,
          fit: 'inside',
          withoutEnlargement: true,
        });
      }

      const { data, info } = await pipeline
        .jpeg({ quality, mozjpeg: true })
        .toBuffer({ resolveWithObject: true });

      return {
        buffer: data,
        mimeType: 'image/jpeg',
        base64Data: data.toString('base64'),
        width: info.width,
        height: info.height,
        wasProcessed: true,
      };
    } catch {
      // Fallback an toàn nếu buffer hỏng hoặc không decode được: giữ nguyên buffer gốc
      return {
        buffer,
        mimeType,
        base64Data: buffer.toString('base64'),
        wasProcessed: false,
      };
    }
  }

  private static parseInput(input: Buffer | string): { buffer: Buffer; mimeType: string } {
    if (Buffer.isBuffer(input)) {
      return { buffer: input, mimeType: 'image/jpeg' };
    }

    const match = input.match(/^data:([a-zA-Z0-9]+\/[a-zA-Z0-9-.+]+);base64,(.+)$/);
    if (match) {
      return {
        mimeType: match[1],
        buffer: Buffer.from(match[2], 'base64'),
      };
    }

    return {
      mimeType: 'image/jpeg',
      buffer: Buffer.from(input, 'base64'),
    };
  }
}
