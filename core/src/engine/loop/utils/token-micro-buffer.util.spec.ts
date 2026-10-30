import { TokenMicroBuffer } from './token-micro-buffer.util';

describe('TokenMicroBuffer', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('flush ngay lập tức khi độ dài buffer >= maxChars', () => {
    const flushed: string[] = [];
    const buffer = new TokenMicroBuffer((chunk) => flushed.push(chunk), {
      maxChars: 15,
      maxIntervalMs: 100,
    });

    buffer.add('Xin chào các ');
    expect(flushed).toHaveLength(0); // 13 chars

    buffer.add('bạn'); // 13 + 3 = 16 chars >= 15
    expect(flushed).toEqual(['Xin chào các bạn']);
  });

  it('flush ngay lập tức khi gặp dấu ngắt câu hoặc ký tự xuống dòng', () => {
    const flushed: string[] = [];
    const buffer = new TokenMicroBuffer((chunk) => flushed.push(chunk), {
      maxChars: 50,
      maxIntervalMs: 100,
    });

    buffer.add('Hello');
    expect(flushed).toHaveLength(0);

    buffer.add(' world.\n');
    expect(flushed).toEqual(['Hello world.\n']);

    buffer.add('Câu hỏi? ');
    expect(flushed).toEqual(['Hello world.\n', 'Câu hỏi? ']);
  });

  it('flush tự động sau maxIntervalMs nếu không có dấu câu và chưa đủ maxChars', () => {
    const flushed: string[] = [];
    const buffer = new TokenMicroBuffer((chunk) => flushed.push(chunk), {
      maxChars: 50,
      maxIntervalMs: 40,
    });

    buffer.add('ab');
    buffer.add('cd');
    expect(flushed).toHaveLength(0);

    jest.advanceTimersByTime(39);
    expect(flushed).toHaveLength(0);

    jest.advanceTimersByTime(2);
    expect(flushed).toEqual(['abcd']);
  });

  it('flush() thủ công đẩy toàn bộ token còn lại trong buffer', () => {
    const flushed: string[] = [];
    const buffer = new TokenMicroBuffer((chunk) => flushed.push(chunk), {
      maxChars: 100,
      maxIntervalMs: 1000,
    });

    buffer.add('còn dư trong buffer');
    expect(flushed).toHaveLength(0);

    buffer.flush();
    expect(flushed).toEqual(['còn dư trong buffer']);

    // Gọi flush lần nữa khi buffer rỗng thì không làm gì
    buffer.flush();
    expect(flushed).toHaveLength(1);
  });

  it('clear() hủy timer và dọn buffer mà không gọi onFlush', () => {
    const flushed: string[] = [];
    const buffer = new TokenMicroBuffer((chunk) => flushed.push(chunk), {
      maxChars: 50,
      maxIntervalMs: 50,
    });

    buffer.add('token chuẩn bị bị hủy');
    buffer.clear();

    jest.advanceTimersByTime(100);
    buffer.flush();

    expect(flushed).toHaveLength(0);
  });

  it('bỏ qua chunk rỗng an toàn', () => {
    const flushed: string[] = [];
    const buffer = new TokenMicroBuffer((chunk) => flushed.push(chunk));

    buffer.add('');
    expect(flushed).toHaveLength(0);
  });
});
