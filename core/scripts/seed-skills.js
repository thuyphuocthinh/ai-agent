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
    name: 'Thống kê đơn hàng và doanh thu',
    description:
      'Thống kê số lượng đơn hàng và tổng doanh thu theo từng trạng thái thanh toán. Dùng khi người dùng cần xem số liệu thống kê đơn hàng hoặc doanh thu bán hàng.',
    tools: ['table_schema', 'read_query', 'post_message'],
    tags: ['thống kê đơn', 'doanh thu', 'số lượng đơn', 'báo cáo đơn hàng'],
    metadata: {
      autoLoad: true,
      triggers: [
        'lập báo cáo tình trạng đơn hàng giúp tôi',
        'thống kê số đơn hàng theo từng trạng thái và tổng tiền',
        'cho tôi báo cáo doanh thu và các đơn chưa có thanh toán thành công',
        'thống kê doanh thu bán hàng theo trạng thái đơn',
        'xem số lượng đơn hàng và tiền thanh toán',
      ],
    },
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
    name: 'Thay đổi, cập nhật hoặc xóa dữ liệu sản phẩm và đơn hàng',
    description:
      'Chỉnh sửa thông tin, đổi tên, cập nhật giá tiền sản phẩm hoặc xóa đơn hàng trong bảng dữ liệu. Dùng khi người dùng yêu cầu sửa giá, đổi tên, cập nhật giá hoặc xóa dữ liệu.',
    tools: ['table_schema', 'read_query', 'execute_write_query'],
    tags: ['cập nhật giá', 'đổi tên', 'xóa đơn hàng', 'sửa thông tin'],
    metadata: {
      autoLoad: true,
      triggers: [
        'đổi tên sản phẩm áo thun thành áo thun cotton',
        'cập nhật giá của giày thể thao lên 750000',
        'xóa các đơn hàng đã hủy khỏi bảng orders',
        'sửa thông tin và cập nhật giá bán mặt hàng',
        'chỉnh sửa dữ liệu bản ghi trong bảng',
      ],
    },
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
    name: 'Kế hoạch nhập hàng tồn kho',
    description:
      'Kiểm tra mức tồn kho sản phẩm và đối chiếu bảng giá nhà cung cấp để lập kế hoạch đề xuất số lượng hàng cần nhập thêm vào kho.',
    tools: ['read_query', 'list_spreadsheets', 'read_range', 'append_rows'],
    tags: ['nhập kho', 'tồn kho', 'hàng tồn', 'kế hoạch nhập hàng'],
    metadata: {
      autoLoad: true,
      triggers: [
        'đề xuất giúp tôi kế hoạch nhập hàng',
        'sản phẩm nào sắp hết hàng cần nhập thêm?',
        'lập kế hoạch nhập hàng quý 4 dựa trên tồn kho và giá nhà cung cấp',
        'kiểm tra mặt hàng sắp hết để đặt thêm hàng',
        'tính số lượng sản phẩm cần nhập kho',
      ],
    },
    instructions: `# Lập kế hoạch nhập hàng

1. Lấy tồn kho: \`read_query\` bảng \`products\` (name, stock, price).
2. Gọi \`list_spreadsheets\` để lấy id của bảng tính "Bảng giá nhà cung cấp" (KHÔNG dùng tên làm id), rồi \`read_range\` tab "Giá" bằng id đó.
3. Một sản phẩm cần nhập khi tồn kho < 20. Số lượng đề xuất = 50 − tồn kho hiện tại.
4. Với mỗi sản phẩm cần nhập, nêu nhà cung cấp và giá nhập dự kiến (số lượng × giá nhập).
5. Chỉ ghi vào bảng tính "Kế hoạch nhập hàng Q4" (lấy id cũng từ \`list_spreadsheets\`) bằng \`append_rows\` (cột: Sản phẩm, Số lượng, Trạng thái = "Đề xuất") SAU KHI người dùng đồng ý với đề xuất.`,
  },
  {
    slug: 'incident-notify',
    name: 'Thông báo sự cố kỹ thuật nội bộ',
    description:
      'Soạn và gửi thông báo khẩn cấp khi hệ thống gặp lỗi kỹ thuật, dịch vụ gián đoạn hoặc trục trặc đường truyền cho quản lý và kênh ops.',
    tools: ['post_message', 'create_draft'],
    tags: ['sự cố', 'thông báo', 'khẩn cấp', 'lỗi hệ thống', 'ops'],
    metadata: {
      autoLoad: true,
      triggers: [
        'thông báo sự cố: cổng thanh toán bị chậm, ảnh hưởng đơn hàng mới',
        'báo cho quản lý biết hệ thống đang gặp sự cố mức cao',
        'soạn thông báo sự cố nội bộ gửi kênh ops',
        'dịch vụ gặp sự cố kỹ thuật khẩn cấp',
        'báo cáo trục trặc hệ thống cho quản lý',
      ],
    },
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
  {
    slug: 'template-preserving-etl',
    name: 'ETL nạp dữ liệu lớn bảo toàn mẫu Google Sheet',
    description:
      'Quy trình trích xuất dữ liệu lớn từ SQL/CRM/File và nạp vào Google Sheet theo mẫu có sẵn mà không làm hỏng công thức hoặc gây lỗi Rate-Limit HTTP 429.',
    tools: ['get_sheet_structure', 'run_python', 'batch_update_values'],
    tags: ['etl', 'google sheets', 'bảo toàn công thức', 'dữ liệu lớn', 'batch update'],
    metadata: {
      autoLoad: true,
      triggers: [
        'đồng bộ dữ liệu đơn hàng vào Google Sheet theo mẫu',
        'nạp danh sách khách hàng vào bảng tính không ghi đè công thức',
        'chuyển dữ liệu lớn vào Sheet tự động',
        'ETL dữ liệu vào Google Sheet bảo toàn template',
      ],
    },
    instructions: `# Quy trình ETL nạp dữ liệu lớn vào Google Sheet (Bảo toàn template & công thức)

Khi xử lý tác vụ trích xuất dữ liệu lớn và nạp vào Google Sheet, BẮT BUỘC tuân thủ 4 bước nghiêm ngặt sau:

1. BƯỚC 1 - KIỂM TRA MẪU (Template Inspection):
   - Luôn gọi \`get_sheet_structure\` trước tiên để lấy metadata: headers, \`firstEmptyRowIndex\`, và danh sách các cột chứa công thức tính toán (\`protectedFormulaColumns\`).
   - Ghi nhớ các cột công thức (ví dụ: cột VAT, Tổng tiền) để KHÔNG ghi đè giá trị tĩnh vào các cột này.

2. BƯỚC 2 - TRÍCH XUẤT DỮ LIỆU & DIRECT-TO-DISK:
   - Thực thi truy vấn nguồn (SQL, CRM, v.v.).
   - Nếu dữ liệu lớn (>50KB), hệ thống sẽ tự động lưu ra file tạm an toàn và trả về envelope dạng:
     \`{"status":"saved_to_tmp","path":"/tmp/artifacts/.../source_xxx.json",...}\`
   - Đọc kỹ đường dẫn file tạm và mẫu 2 bản ghi để nắm bắt cấu trúc dữ liệu.

3. BƯỚC 3 - CHUYỂN ĐỔI BẰNG SANDBOX (Python Compute):
   - KHÔNG bao giờ tự render toàn bộ mảng dữ liệu khổng lồ vào ngữ cảnh hội thoại.
   - Sử dụng tool \`run_python\` để chạy script trong Sandbox Docker cách ly:
     + Đọc file JSON từ đường dẫn nguồn (\`path\`).
     + Chuyển đổi và sắp xếp đúng thứ tự các cột khớp với headers của Sheet (bỏ qua hoặc để trống các cột công thức).
     + Xuất kết quả ma trận mảng 2D ra file JSON đích trên thư mục tạm (ví dụ: \`transformed_matrix.json\`).

4. BƯỚC 4 - CẬP NHẬT NGUYÊN TỬ (Atomic Batch Update):
   - Gọi tool \`batch_update_values\` TRONG ĐÚNG 1 LẦN DUY NHẤT.
   - Truyền tham số \`payloadFilePath\` trỏ tới file JSON ma trận đã chuyển đổi và \`range\` bắt đầu từ dòng trống đầu tiên (\`firstEmptyRowIndex\`).
   - Tuyệt đối KHÔNG gọi cập nhật từng dòng hoặc từng ô lẻ tẻ để tránh lỗi Rate-Limit HTTP 429 và quá tải API.`,
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
  console.error('seed:skills thất bại:', error.message);
  process.exit(1);
});
