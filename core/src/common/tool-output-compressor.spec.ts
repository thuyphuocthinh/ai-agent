import { ToolOutputCompressor } from './tool-output-compressor';

describe('ToolOutputCompressor', () => {
  beforeEach(() => {
    ToolOutputCompressor.clearCache();
  });

  it('giữ nguyên dữ liệu nếu độ dài nhỏ hơn ngưỡng maxCharacters', () => {
    const smallData = { status: 'success', count: 10 };
    const res = ToolOutputCompressor.compress(smallData, { maxCharacters: 1000 });

    expect(res.isTruncated).toBe(false);
    expect(res.dataRef).toBeUndefined();
    expect(JSON.parse(res.text)).toEqual(smallData);
  });

  it('nén mảng lớn thành envelope chứa sample và lưu trữ raw dataRef', () => {
    // Tạo mảng 200 bản ghi
    const largeArray = Array.from({ length: 200 }, (_, i) => ({
      id: `record_${i + 1}`,
      name: `Khách hàng ${i + 1}`,
      amount: i * 1000,
    }));

    const res = ToolOutputCompressor.compress(largeArray, {
      maxCharacters: 1000, // Cố tình đặt ngưỡng nhỏ để kích hoạt nén nhưng đủ cho 3 mẫu
      sampleCount: 2,
    });

    expect(res.isTruncated).toBe(true);
    expect(res.dataRef).toBeDefined();

    const parsed = JSON.parse(res.text);
    expect(parsed._data_summary.total_records).toBe(200);
    expect(parsed._data_summary.is_truncated).toBe(true);
    expect(parsed.sample_records.length).toBe(3); // 2 head + 1 tail

    // Kiểm tra lấy lại raw data từ dataRef
    const raw = ToolOutputCompressor.getRawPayload(res.dataRef!);
    expect(raw).toBeDefined();
    expect(JSON.parse(raw!).length).toBe(200);
  });

  it('tự động giảm số lượng mẫu khi kích thước mẫu vượt quá ngân sách maxCharacters', () => {
    const largeArray = Array.from({ length: 200 }, (_, i) => ({
      id: `record_${i + 1}`,
      name: `Khách hàng ${i + 1}`,
      amount: i * 1000,
    }));

    const res = ToolOutputCompressor.compress(largeArray, {
      maxCharacters: 450, // Ngưỡng không đủ cho 3 mẫu (~550 chars) nhưng đủ cho 1 mẫu (~400 chars)
      sampleCount: 2,
    });

    expect(res.isTruncated).toBe(true);
    expect(res.dataRef).toBeDefined();

    const parsed = JSON.parse(res.text);
    expect(parsed._data_summary.total_records).toBe(200);
    expect(parsed.sample_records.length).toBe(1); // Tự động giảm xuống 1 mẫu để vừa ngân sách
  });

  it('cắt an toàn text thô lớn và giữ lại head/tail kèm dataRef', () => {
    const largeText = 'A'.repeat(5000);
    const res = ToolOutputCompressor.compress(largeText, { maxCharacters: 1000 });

    expect(res.isTruncated).toBe(true);
    expect(res.text).toContain('[CẮT BỚT');
    expect(res.text).toContain('[DATA REFERENCE ID:');
    expect(res.dataRef).toBeDefined();

    const raw = ToolOutputCompressor.getRawPayload(res.dataRef!);
    expect(raw).toBe(largeText);
  });
});
