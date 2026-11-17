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
});
