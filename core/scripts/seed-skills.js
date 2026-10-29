/**
 * Seed vài skill (playbook nghiệp vụ) mẫu vào bảng orchestration_skills, tenant `default`
 * (skill dùng chung cho mọi tenant). Idempotent: chạy lại sẽ cập nhật theo (tenantId, slug).
 *
 * Chạy: `pnpm --filter @agent/core seed:skills` (cần DATABASE_URL và đã áp migration).
 */
const { PrismaClient } = require('@prisma/client');

const TENANT_ID = 'default';

const SKILLS = [
  {
    slug: 'order-status-report',
    name: 'Báo cáo tình trạng đơn hàng',
    description:
      'Quy trình lập báo cáo đơn hàng theo trạng thái từ SQL và gửi vào kênh Slack. Dùng khi người dùng muốn thống kê/báo cáo đơn hàng, doanh thu, thanh toán.',
    tools: ['table_schema', 'read_query', 'post_message'],
    tags: ['sql', 'slack', 'report'],
    instructions: `# Báo cáo tình trạng đơn hàng

1. Gọi \`table_schema\` để xác nhận cột của bảng \`orders\` và \`payments\` (KHÔNG đoán tên cột).
2. Dùng \`read_query\` đếm đơn và tổng tiền theo \`status\` (GROUP BY status). Chỉ dùng SELECT.
3. Đối chiếu \`payments\`: liệt kê đơn chưa có thanh toán thành công.
4. Soạn báo cáo ngắn gọn theo ĐÚNG khuôn dạng:
   - Dòng đầu tiên: "📊 BÁO CÁO ĐƠN HÀNG"
   - Mỗi trạng thái một dòng: "<trạng thái>: <số đơn> đơn — <tổng tiền> đ"
   - Dòng cuối cùng: "Hết báo cáo."
5. Chỉ đăng lên Slack (\`post_message\`, kênh #ops) khi người dùng yêu cầu rõ; nếu không thì trả báo cáo ngay trong câu trả lời.

Lưu ý: số liệu trong báo cáo PHẢI lấy từ kết quả truy vấn, không tự tính nhẩm.`,
  },
  {
    slug: 'sql-safe-write',
    name: 'Ghi dữ liệu SQL an toàn',
    description:
      'Dùng MỖI KHI cần thêm/sửa/đổi tên/xóa dữ liệu trong cơ sở dữ liệu (INSERT/UPDATE/DELETE): kiểm tra schema, đếm bản ghi bị ảnh hưởng trước, luôn có WHERE, xác nhận sau khi ghi.',
    tools: ['table_schema', 'read_query', 'execute_write_query'],
    tags: ['sql', 'safety'],
    instructions: `# Ghi dữ liệu SQL an toàn

Trước khi gọi \`execute_write_query\`:
1. Gọi \`table_schema\` để biết đúng tên bảng/cột và kiểu dữ liệu.
2. Với UPDATE/DELETE: BẮT BUỘC có mệnh đề WHERE cụ thể. Tuyệt đối không UPDATE/DELETE toàn bảng.
3. Chạy \`read_query\` với cùng điều kiện WHERE (SELECT COUNT(*)) để biết số bản ghi sẽ bị ảnh hưởng, nói rõ con số này với người dùng.
4. Nếu số bản ghi lớn hơn 10 hoặc khác với người dùng mong đợi → DỪNG và hỏi lại.

Sau khi ghi:
5. Chạy lại \`read_query\` để xác nhận kết quả đúng như ý định, báo cáo lại cho người dùng.`,
  },
  {
    slug: 'restock-planning',
    name: 'Lập kế hoạch nhập hàng',
    description:
      'Quy trình đề xuất nhập hàng: đối chiếu tồn kho trong SQL với bảng giá nhà cung cấp trên Google Sheets rồi ghi kế hoạch.',
    tools: ['read_query', 'list_spreadsheets', 'read_range', 'append_rows'],
    tags: ['sql', 'sheets', 'inventory'],
    instructions: `# Lập kế hoạch nhập hàng

1. Lấy tồn kho: \`read_query\` bảng \`products\` (name, stock, price).
2. Gọi \`list_spreadsheets\` để lấy id của bảng tính "Bảng giá nhà cung cấp" (KHÔNG dùng tên làm id), rồi \`read_range\` tab "Giá" bằng id đó.
3. Một sản phẩm cần nhập khi tồn kho < 20. Số lượng đề xuất = 50 − tồn kho hiện tại.
4. Với mỗi sản phẩm cần nhập, nêu nhà cung cấp và giá nhập dự kiến (số lượng × giá nhập).
5. Chỉ ghi vào bảng tính "Kế hoạch nhập hàng Q4" (lấy id cũng từ \`list_spreadsheets\`) bằng \`append_rows\` (cột: Sản phẩm, Số lượng, Trạng thái = "Đề xuất") SAU KHI người dùng đồng ý với đề xuất.`,
  },
  {
    slug: 'incident-notify',
    name: 'Thông báo sự cố nội bộ',
    description:
      'Quy trình thông báo sự cố: soạn nội dung theo mẫu chuẩn, đăng kênh Slack #ops và tạo email nháp cho quản lý.',
    tools: ['post_message', 'create_draft'],
    tags: ['slack', 'mail', 'incident'],
    instructions: `# Thông báo sự cố nội bộ

Mẫu nội dung bắt buộc (mỗi mục một dòng):
- Mức độ: THẤP / TRUNG BÌNH / CAO
- Ảnh hưởng: ai/hệ thống nào bị ảnh hưởng
- Hiện trạng: đã xác nhận gì, chưa biết gì
- Hành động tiếp theo và người phụ trách

Các bước:
1. Xác nhận với người dùng mức độ và ảnh hưởng nếu chưa rõ — KHÔNG tự suy đoán nguyên nhân.
2. Đăng nội dung vào kênh #ops bằng \`post_message\` (cần người dùng duyệt).
3. Tạo email nháp cho quản lý bằng \`create_draft\` với cùng nội dung; KHÔNG tự gửi email.`,
  },
];

async function main() {
  const prisma = new PrismaClient();
  try {
    for (const skill of SKILLS) {
      const saved = await prisma.skill.upsert({
        where: { tenantId_slug: { tenantId: TENANT_ID, slug: skill.slug } },
        create: { tenantId: TENANT_ID, ...skill },
        update: { ...skill, isActive: true },
      });
      console.log(`✔ ${saved.tenantId}/${saved.slug}`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error('Seed skills thất bại:', error.message);
  process.exit(1);
});
