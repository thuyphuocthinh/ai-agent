import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { PresignedUrlRequestDto } from './presigned-url.dto';

async function errorsOf(payload: object) {
  const errors = await validate(plainToInstance(PresignedUrlRequestDto, payload));
  return errors.map((e) => e.property);
}

describe('PresignedUrlRequestDto validation', () => {
  it('accepts valid request with supported image content types', async () => {
    for (const contentType of ['image/png', 'image/jpeg', 'image/webp', 'image/gif']) {
      const errors = await errorsOf({
        filename: 'invoice.png',
        contentType,
      });
      expect(errors).toEqual([]);
    }
  });

  it('accepts valid request with optional expiresInSeconds', async () => {
    const errors = await errorsOf({
      filename: 'chart.jpg',
      contentType: 'image/jpeg',
      expiresInSeconds: 600,
    });
    expect(errors).toEqual([]);
  });

  it('rejects empty or missing filename', async () => {
    const errors = await errorsOf({
      filename: '   ',
      contentType: 'image/png',
    });
    expect(errors).toContain('filename');
  });

  it('rejects unsupported content type (e.g. application/pdf, text/html)', async () => {
    const pdfErrors = await errorsOf({
      filename: 'document.pdf',
      contentType: 'application/pdf',
    });
    expect(pdfErrors).toContain('contentType');

    const htmlErrors = await errorsOf({
      filename: 'page.html',
      contentType: 'text/html',
    });
    expect(htmlErrors).toContain('contentType');
  });

  it('rejects negative or zero expiresInSeconds', async () => {
    const errors = await errorsOf({
      filename: 'receipt.png',
      contentType: 'image/png',
      expiresInSeconds: -10,
    });
    expect(errors).toContain('expiresInSeconds');
  });
});
