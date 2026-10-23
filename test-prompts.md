# 🧪 Test Prompts Suite (Từ Cơ Bản Đến Phức Tạp Đa Agent)

Bộ prompt mẫu được thiết kế sẵn theo dữ liệu mock (`MOCK_TOOLS=true`) của hệ thống, giúp bạn dễ dàng copy & paste vào **Playground Web** (`http://localhost:3001`) hoặc **CLI** (`pnpm start:cli`) để kiểm thử khả năng phân rã kế hoạch (Planning), thực thi công cụ (ReAct Loop), chạy song song (Parallel Fan-out), và tổng hợp câu trả lời (Synthesis).

---

## 📑 Mục lục
1. [Cấp độ 1: Đơn giản (Direct / 1 Agent Đơn Lẻ)](#cấp-độ-1-đơn-giản-direct--1-agent-đơn-lẻ)
2. [Cấp độ 2: Trung bình (2 Agents Phối Hợp Tuần Tự)](#cấp-độ-2-trung-bình-2-agents-phối-hợp-tuần-tự)
3. [Cấp độ 3: Nâng cao (3 Agents - Chạy Song Song & Đối Soát)](#cấp-độ-3-nâng-cao-3-agents---chạy-song-song--đối-soát)
4. [Cấp độ 4: Rất phức tạp (4 - 5 Agents - Đại Kế Hoạch Đa Nguồn)](#cấp-độ-4-rất-phức-tạp-4---5-agents---đại-kế-hoạch-đa-nguồn)
5. [Cấp độ 5: Human-In-The-Loop (HITL Duyệt Lệnh Ghi / Risk Gate)](#cấp-độ-5-human-in-the-loop-hitl-duyệt-lệnh-ghi--risk-gate)

---

## Cấp độ 1: Đơn giản (Direct / 1 Agent Đơn Lẻ)

### 1.1 Không gọi công cụ (Direct Response / Chào hỏi)
* **Mục tiêu**: Kiểm tra Supervisor nhận diện câu hỏi thường và phản hồi ngay lập tức (`action: "respond"`), không gọi bất kỳ tool nào.
```text
Xin chào, bạn là ai và bạn có thể hỗ trợ tôi những công việc gì trong hệ thống này?
```

### 1.2 Truy vấn CSDL SQL (`sql_server`)
* **Mục tiêu**: Agent `sql_server` gọi `table_schema` và `read_query`.
```text
Kiểm tra giúp tôi danh sách tất cả sản phẩm đang có trong cơ sở dữ liệu và giá bán hiện tại của từng món.
```

### 1.3 Đọc Google Sheets (`google_sheets`)
* **Mục tiêu**: Agent `google_sheets` tìm spreadsheet và đọc bảng giá nhà cung cấp.
```text
Đọc giúp tôi bảng giá nhà cung cấp trong Google Sheets xem sản phẩm Giày thể thao có giá nhập và giá đề xuất là bao nhiêu?
```

### 1.4 Tìm kiếm Email (`google_mail`)
* **Mục tiêu**: Agent `google_mail` gọi `search_emails` hoặc `list_emails` trong hộp thư đến.
```text
Kiểm tra trong hộp thư đến xem gần đây có email nào của khách hàng tên là Bình không, và tóm tắt nội dung email đó.
```

### 1.5 Đọc tin nhắn Slack (`slack`)
* **Mục tiêu**: Agent `slack` tra cứu danh sách kênh và đọc tin nhắn mới nhất trong kênh `#ops`.
```text
Vào kênh Slack #ops xem các tin nhắn gần đây nhất thảo luận về vấn đề gì?
```

### 1.6 Tra cứu GitHub (`github`)
* **Mục tiêu**: Agent `github` gọi `list_issues` lọc các bug đang mở.
```text
Liệt kê các issue đang mở (open) trên GitHub repo acme/shop-backend liên quan đến cổng thanh toán.
```

---

## Cấp độ 2: Trung bình (2 Agents Phối Hợp Tuần Tự)

### 2.1 Đối soát CSDL với Google Sheets (`sql_server` + `google_sheets`)
* **Mục tiêu**: Supervisor chia làm 2 bước: lấy giá bán thực tế trong database SQL, sau đó lấy giá đề xuất từ Google Sheets và so sánh chênh lệch.
```text
So sánh giá bán thực tế của các sản phẩm trong database SQL với giá bán đề xuất của nhà cung cấp trong Google Sheets xem có sản phẩm nào bị bán lệch giá không?
```

### 2.2 Xử lý khiếu nại khách hàng (`google_mail` + `sql_server`)
* **Mục tiêu**: Đọc email của khách Bình để lấy mã đơn hàng, sau đó tra cứu CSDL SQL để xem trạng thái đơn và thanh toán.
```text
Khách hàng Bình vừa gửi email khiếu nại về một đơn hàng. Hãy kiểm tra nội dung email của Bình, sau đó tra cứu CSDL để xem đơn hàng đó hiện có trạng thái gì và đã thanh toán thành công chưa.
```

### 2.3 Điều tra sự cố kỹ thuật (`slack` + `github`)
* **Mục tiêu**: Đọc kênh Slack `#ops` để tìm manh mối sự cố thanh toán, sau đó kiểm tra GitHub xem có issue hoặc pull request nào đang fix lỗi đó không.
```text
Kiểm tra các trao đổi trong kênh Slack #ops về lỗi cổng thanh toán, sau đó tra cứu GitHub xem sự cố này đang được theo dõi ở Issue số mấy và có Pull Request nào đang sửa không?
```

### 2.4 Cập nhật giá nhà cung cấp (`google_mail` + `google_sheets`)
* **Mục tiêu**: Đọc email báo giá mới từ đối tác Sneaker Hub và đối chiếu với bảng giá cũ trong Google Sheets.
```text
Kiểm tra email báo giá mới nhất từ đối tác Sneaker Hub trong hộp thư, sau đó đối chiếu với bảng giá nhà cung cấp trong Google Sheets xem giá nhập mới tăng hay giảm bao nhiêu tiền?
```

---

## Cấp độ 3: Nâng cao (3 Agents - Chạy Song Song & Đối Soát)

### 3.1 Điều tra toàn diện đơn hàng bị kẹt (`google_mail` + `sql_server` + `slack`)
* **Mục tiêu**: Supervisor kích hoạt song song/phối hợp giữa 3 agent để gom toàn bộ thông tin từ Email khách, CSDL backend và thảo luận nội bộ.
```text
Khách hàng Bình phản ánh không nhận được hàng. Hãy điều tra toàn diện giúp tôi:
1. Đọc email khiếu nại của khách hàng Bình xem phản ánh cụ thể vấn đề gì.
2. Tra cứu trong SQL thông tin chi tiết đơn hàng 102 (sản phẩm, số tiền, trạng thái đơn và thanh toán).
3. Kiểm tra kênh Slack #sales và #ops xem nội bộ nhân viên đã trao đổi về đơn hàng này như thế nào.
Tổng hợp lại bức tranh toàn cảnh để tôi nắm tình hình.
```

### 3.2 Tình trạng tồn kho và kế hoạch nhập hàng (`sql_server` + `google_sheets` + `slack`)
* **Mục tiêu**: Kết hợp dữ liệu kho vận hành (Slack `#ops`), kế hoạch Q4 (Google Sheets) và dữ liệu sản phẩm bán ra (SQL).
```text
Tôi cần báo cáo nhanh về tình hình mặt hàng "Giày thể thao":
1. Kênh Slack #ops cảnh báo tồn kho mặt hàng này còn lại bao nhiêu đôi?
2. Trong Google Sheets, kế hoạch nhập hàng Q4 đã lên lịch nhập thêm bao nhiêu đôi và trạng thái duyệt ra sao?
3. Trong database SQL, sản phẩm này giá bao nhiêu và gần đây có những đơn hàng nào đặt mua?
```

### 3.3 Đánh giá tiến độ xử lý Bug thanh toán (`github` + `slack` + `sql_server`)
* **Mục tiêu**: Phối hợp giữa Dev (GitHub), Vận hành (Slack) và Dữ liệu kinh doanh (SQL).
```text
Hãy đánh giá mức độ ảnh hưởng của lỗi cổng thanh toán:
1. Tra cứu GitHub issue #12 và PR #20 xem nguyên nhân lỗi là gì, ai phụ trách và PR sửa lỗi đã sẵn sàng chưa.
2. Kiểm tra Slack #ops xem sự cố này bắt đầu từ khi nào.
3. Chạy truy vấn SQL thống kê xem có bao nhiêu đơn hàng đang bị kẹt ở trạng thái pending hoặc chưa thanh toán.
```

---

## Cấp độ 4: Rất phức tạp (4 - 5 Agents - Đại Kế Hoạch Đa Nguồn)

### 4.1 Báo cáo tổng thể sự cố vận hành toàn công ty (5 Agents)
* **Mục tiêu**: Supervisor lập kế hoạch phân rã 5 bước độc lập, chạy fan-out song song đa agent, sau đó synthesize tổng hợp:
  - `google_mail`: Đọc khiếu nại khách hàng.
  - `sql_server`: Tra cứu thông tin đơn hàng và bảng thanh toán.
  - `slack`: Thu thập góc nhìn vận hành và kho bãi từ 2 kênh `#ops` và `#sales`.
  - `github`: Kiểm tra tiến độ fix bug kỹ thuật từ repo backend.
  - `google_sheets`: Đối chiếu chính sách giá và kế hoạch nhập hàng bổ sung.
```text
Hãy lập một báo cáo sự cố toàn diện (Incident Post-Mortem) về trường hợp đơn hàng 102 của khách hàng Bình:
1. Đọc email của khách Bình trong Gmail để nắm thời gian và nội dung phản ánh.
2. Tra cứu SQL lấy chi tiết đơn hàng 102 và lịch sử thanh toán tương ứng.
3. Vào kênh Slack #ops và #sales thu thập thông tin về thời điểm cổng thanh toán gặp sự cố và tình trạng kho hàng hiện tại.
4. Tra cứu GitHub repo acme/shop-backend xem issue và pull request sửa lỗi này đang ở trạng thái nào, checks có pass không.
5. Kiểm tra Google Sheets xem sản phẩm trong đơn hàng này có trong kế hoạch nhập hàng Q4 không và giá nhập là bao nhiêu.

Hãy tổng hợp lại thành một báo cáo chuyên nghiệp gồm: (A) Tóm tắt sự cố, (B) Nguyên nhân kỹ thuật, (C) Tác động tới khách hàng và tồn kho, (D) Đề xuất hành động xử lý ngay cho khách Bình.
```

### 4.2 Thẩm định kế hoạch kinh doanh và nhập hàng Q4 (4 Agents)
* **Mục tiêu**: Phân tích dữ liệu đa chiều giữa thị trường (Email báo giá), kế hoạch nội bộ (Sheets), thảo luận team (Slack), và doanh số thực tế (SQL).
```text
Tôi đang chuẩn bị phê duyệt ngân sách nhập hàng cho Quý 4, hãy giúp tôi đối soát các nguồn dữ liệu sau:
1. Trong Google Sheets, xem danh sách tất cả sản phẩm trong "Kế hoạch nhập hàng Q4" và số lượng dự kiến.
2. Trong Gmail, kiểm tra xem có email báo giá mới nào từ nhà cung cấp (đặc biệt là Sneaker Hub) không.
3. Trong database SQL, kiểm tra doanh số và số lượng đã bán của các sản phẩm này trong bảng orders.
4. Trong Slack kênh #sales và #ops, xem phản ánh của đội ngũ về mặt hàng nào đang bán chạy hoặc sắp hết hàng.
Đưa ra kết luận: Kế hoạch nhập hàng hiện tại đã hợp lý chưa và cần điều chỉnh số lượng hay giá sản phẩm nào?
```

---

## Cấp độ 5: Human-In-The-Loop (HITL Duyệt Lệnh Ghi / Risk Gate)

*Các prompt này sẽ kích hoạt công cụ có tính chất thay đổi dữ liệu (`execute_write_query`, ghi email, gửi tin nhắn). Agent sẽ dừng lại tại trạng thái **Awaiting Approval** kèm nút **Phê duyệt (Approve) / Từ chối (Reject)** trên giao diện Playground.*

### 5.1 Cập nhật dữ liệu CSDL SQL (Risk Gate: Destructive DB Write)
* **Mục tiêu**: Kích hoạt `execute_write_query` trên `sql_server`. Hệ thống sẽ hiển thị câu lệnh SQL và chờ bạn phê duyệt.
```text
Tôi muốn hủy đơn hàng 102 vì khách không thanh toán được. Hãy cập nhật trạng thái của đơn hàng 102 trong bảng orders thành 'cancelled' giúp tôi.
```

### 5.2 Khôi phục trạng thái đơn hàng sau khi sửa lỗi thanh toán
* **Mục tiêu**: Tra cứu thông tin đơn trước, sau đó yêu cầu chạy lệnh ghi cập nhật.
```text
Kiểm tra đơn hàng 102 trong database, nếu đang ở trạng thái 'pending' thì hãy cập nhật sang 'paid' để kho chuẩn bị đóng gói hàng cho khách Bình.
```

---

## 💡 Mẹo khi kiểm thử trên Playground UI

1. **Xem Timeline trực quan**: Mỗi khi Agent thực thi một bước, Playground sẽ hiển thị từng bước `Planning`, `Delegation`, `Tool Call`, và `Tool Result` theo thời gian thực (Real-time Stream).
2. **Kiểm tra Token Streaming**: Ở các câu trả lời tổng hợp (Synthesize), văn bản sẽ stream từng từ một (word-by-word) mượt mà.
3. **Phê duyệt HITL**: Khi gặp prompt Cấp độ 5, UI sẽ bật lên modal/card yêu cầu duyệt với thông số preview tham số gọi tool rõ ràng.
