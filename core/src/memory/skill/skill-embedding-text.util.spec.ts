import { buildSkillEmbeddingText } from './skill-embedding-text.util';

describe('buildSkillEmbeddingText', () => {
  it('joins name, description and tags', () => {
    expect(
      buildSkillEmbeddingText({
        name: 'Ghi SQL an toàn',
        description: 'Quy tắc khi sửa dữ liệu',
        tags: ['sql', 'safety'],
      }),
    ).toBe('Ghi SQL an toàn. Quy tắc khi sửa dữ liệu. sql, safety');
  });

  it('omits the tags part when the skill has no tag', () => {
    expect(
      buildSkillEmbeddingText({ name: 'A', description: 'B', tags: [] }),
    ).toBe('A. B');
  });

  it('appends triggers when present in metadata', () => {
    expect(
      buildSkillEmbeddingText({
        name: 'Ghi SQL',
        description: 'Sửa dữ liệu',
        tags: ['sql'],
        metadata: { triggers: ['đổi tên sản phẩm', 'cập nhật giá'] },
      }),
    ).toBe('Ghi SQL. Sửa dữ liệu. sql. Các câu lệnh mẫu: đổi tên sản phẩm; cập nhật giá');
  });
});
