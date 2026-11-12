import { isStructuredPayload } from './structured-payload.util';

describe('isStructuredPayload', () => {
  it('returns true for JSON object strings', () => {
    expect(
      isStructuredPayload(
        '{"spreadsheetId":"sheet_prices","updatedRange":"Giá!A2","updatedRows":1000}',
      ),
    ).toBe(true);
    expect(isStructuredPayload('   { "status": "ok" }  ')).toBe(true);
  });

  it('returns true for JSON array strings', () => {
    expect(isStructuredPayload('[1, 2, 3]')).toBe(true);
    expect(isStructuredPayload('  [{"id": 1}]  ')).toBe(true);
  });

  it('returns false for plain text conversational answers', () => {
    expect(
      isStructuredPayload(
        'Đã cập nhật thành công 1.000 dòng dữ liệu vào bảng tính Giá.',
      ),
    ).toBe(false);
    expect(isStructuredPayload('Xin chào, tôi có thể giúp gì cho bạn?')).toBe(
      false,
    );
  });

  it('returns false for malformed JSON or text with braces inside', () => {
    expect(isStructuredPayload('{ incomplete json')).toBe(false);
    expect(isStructuredPayload('Đây là dữ liệu { key: value }')).toBe(false);
  });

  it('returns false for empty, null or undefined input', () => {
    expect(isStructuredPayload('')).toBe(false);
    expect(isStructuredPayload(undefined)).toBe(false);
  });
});
