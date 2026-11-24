import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ChatRequestDto } from './chat-request.dto';

async function errorsOf(payload: object) {
  const errors = await validate(plainToInstance(ChatRequestDto, payload));
  return errors.map((e) => e.property);
}

describe('ChatRequestDto validation', () => {
  it('accepts valid text-only chat request', async () => {
    const errors = await errorsOf({
      prompt: 'Hello world',
    });
    expect(errors).toEqual([]);
  });

  it('accepts valid chat request with imageUrl', async () => {
    const errors = await errorsOf({
      prompt: 'Analyze this invoice',
      imageUrl: 'https://example.com/invoice.png',
    });
    expect(errors).toEqual([]);
  });

  it('accepts localhost imageUrl without top-level domain', async () => {
    const errors = await errorsOf({
      prompt: 'Analyze this local invoice',
      imageUrl: 'http://localhost:3000/api/storage/local/attachments/test-123.png',
    });
    expect(errors).toEqual([]);

    const ipErrors = await errorsOf({
      prompt: 'Analyze this local IP invoice',
      imageUrl: 'http://127.0.0.1:3000/api/storage/local/attachments/test-123.png',
    });
    expect(ipErrors).toEqual([]);
  });

  it('rejects invalid imageUrl format', async () => {
    const errors = await errorsOf({
      prompt: 'Analyze this invoice',
      imageUrl: 'not-a-valid-url',
    });
    expect(errors).toContain('imageUrl');
  });

  it('accepts valid chat request with imageBase64', async () => {
    const errors = await errorsOf({
      prompt: 'Analyze this screenshot',
      imageBase64: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    });
    expect(errors).toEqual([]);
  });

  it('rejects non-string imageBase64', async () => {
    const errors = await errorsOf({
      prompt: 'Analyze this screenshot',
      imageBase64: 12345,
    });
    expect(errors).toContain('imageBase64');
  });

  it('accepts valid images array with up to 5 URLs', async () => {
    const errors = await errorsOf({
      prompt: 'Analyze these multi invoices',
      images: [
        'https://example.com/inv1.jpg',
        'http://localhost:3000/api/storage/local/attachments/inv2.png',
        'https://example.com/inv3.webp',
      ],
    });
    expect(errors).toEqual([]);
  });

  it('rejects images when exceeding 5 items', async () => {
    const errors = await errorsOf({
      prompt: 'Too many images',
      images: [
        'https://example.com/1.jpg',
        'https://example.com/2.jpg',
        'https://example.com/3.jpg',
        'https://example.com/4.jpg',
        'https://example.com/5.jpg',
        'https://example.com/6.jpg',
      ],
    });
    expect(errors).toContain('images');
  });

  it('rejects images when containing an invalid URL string', async () => {
    const errors = await errorsOf({
      prompt: 'Invalid URL inside images',
      images: ['https://example.com/valid.jpg', 'invalid-non-url-path'],
    });
    expect(errors).toContain('images');
  });

  it('applies @Trim() to remove leading and trailing whitespaces', () => {
    const instance = plainToInstance(ChatRequestDto, {
      prompt: '   Prompt with whitespaces   ',
      imageUrl: '  https://example.com/test.png  ',
      workflowId: '   custom-workflow   ',
    });
    expect(instance.prompt).toBe('Prompt with whitespaces');
    expect(instance.imageUrl).toBe('https://example.com/test.png');
    expect(instance.workflowId).toBe('custom-workflow');
  });
});
