# Enterprise AI Agent (`@agent/core` & `@agent/cli`)

Monorepo nền tảng điều phối AI Agent đa năng xây dựng bằng **NestJS + TypeScript**, hỗ trợ cả **Single-Agent ReAct Loop**, **Multi-Agent Supervisor** (`hybrid`), **Fixed Workflows**, kiểm soát an ninh nhiều lớp và phê duyệt người thật (**Human-in-the-Loop**).

---

## Kiến trúc & Tính năng chính

Hệ thống được thiết kế theo kiến trúc phân tầng chặt chẽ (`constants → contracts → common → infrastructure → memory | security → engine → api`, kiểm soát tự động qua `pnpm arch`):

- **Orchestration Engine linh hoạt:**
  - **Hybrid Mode** (mặc định): dùng Single Agent ReAct cho tác vụ đơn giản, tự động nâng lên **Multi-Agent Supervisor** khi cần tách nhánh song song hoặc xử lý chuyên sâu.
  - **Fixed Workflows & Deterministic Pipelines:** chạy tuần tự / song song theo cấu hình cố định (`GET /api/workflows`).
  - **Multi-LLM Strategy:** hỗ trợ `OpenAI`, `Gemini`, `Anthropic`, `DeepSeek` (cùng `MockStrategy` phục vụ test offline).
- **Quản trị ngữ cảnh đường dài (Long-Horizon Context):**
  - **Rolling Conversation Compaction:** tự động tóm tắt lịch sử khi vượt ngưỡng budget mà vẫn giữ toàn vẹn các lượt gần nhất.
  - **Tool Payload Artifact Handoff & History Search:** đẩy output tool cỡ lớn ra artifact (`read_conversation_artifact`) và hỗ trợ tra cứu ngược hội thoại cũ trong PostgreSQL (`search_conversation_history`).
  - **Skill Playbooks:** lưu trữ và nạp playbook nghiệp vụ động qua pgvector (`POST /api/skills`, bảo vệ bằng `x-admin-key`).
- **Hệ sinh thái Tools & Tích hợp:**
  - **MCP Clients (`@modelcontextprotocol/sdk`):** kết nối công cụ ngoài qua Streamable HTTP, truyền `X-Internal-Api-Key` và `X-Owner-Id` theo từng người dùng.
  - **Dynamic OpenAPI Providers (`agentic-openapi-parser`):** nạp Swagger/OpenAPI spec, lọc Top-K endpoint bằng `SemanticToolIndex` khi spec lớn, tự động refresh OAuth2 token.
  - **Native Tools & Compute Sandbox:** công cụ TS thuần (Zod schema), Google Sheets tools và container Python sandbox cách ly mạng (`sandbox-compute`).
- **Bảo mật, Chịu tải & HITL:**
  - **Human-in-the-Loop (HITL):** tạm dừng tại checkpoint trước hành động rủi ro/ghi dữ liệu để chờ xác nhận qua `POST /api/approve`, kèm cơ chế `HUMAN_TAKEOVER` cho CSKH tiếp quản phiên chat.
  - **Guardrails:** `PromptInjectionGuard`, `PII Scrubber`, `SSRF Guard` (chặn IP nội bộ/loopback khi đọc URL), `ToolRiskGate` + `SemanticPolicyEvaluator`, Audit Trail.
  - **Phân tán & Streaming:** BullMQ + Redis (lock, circuit breaker, cancellation) và stream SSE chuẩn **Vercel AI UI Message Stream** (`POST /api/chat`, `GET /api/stream`).
- **Đa phương thức (Multimodal):** hỗ trợ đính kèm `imageUrl`, `imageBase64` hoặc danh sách tối đa 5 ảnh qua OCR/Vision.

---

## Cấu trúc Monorepo

```text
.
├── core/                         # @agent/core — NestJS Orchestration Engine, API, Memory, Security, Tools
│   ├── prisma/schema.prisma      # PostgreSQL + pgvector schema (users, conversations, checkpoints, skills...)
│   └── src/
│       ├── constants/            # Hằng số, error codes
│       ├── contracts/            # Interfaces, DTOs, DI tokens (không chứa implementation)
│       ├── common/               # Utilities, action summary, PII text helpers
│       ├── infrastructure/       # Prisma, Redis, BullMQ, S3/Local Storage, Embedding, MCP/OpenAPI/Native tools
│       ├── memory/               # Conversation memory, compaction repos, skill catalog & matching
│       ├── security/             # Prompt injection guard, policy engine, crypto audit receipts
│       ├── engine/               # ReAct loop, Supervisor, HITL, OCR, LLM strategies, Workflows
│       └── api/                  # REST & SSE controllers (/api/chat, /api/approve, /api/skills, /api/workflows...)
├── cli/                          # @agent/cli — REPL console & Web Playground (`pnpm cli`, `pnpm cli:web`)
├── docs/                         # Tài liệu kiến trúc (7 layers, streaming/queue, coding standards)
├── specs/                        # Spec-Driven Development (SDD) specs & feature history
└── docker-compose.local.yml      # Local Redis 7, PostgreSQL 15 và Python sandbox-compute
```

---

## Yêu cầu môi trường

- **Node.js** `>= 22.12`
- **pnpm**
- **Docker** (chạy PostgreSQL + Redis cục bộ qua `docker-compose.local.yml`)

---

## Cài đặt & Chạy Local

1. **Cài dependencies:**
   ```bash
   pnpm install
   ```

2. **Tạo file môi trường từ mẫu:**
   ```bash
   cp .env.example .env
   ```
   Điền ít nhất API key của LLM provider bạn sử dụng (ví dụ `OPENAI_API_KEY`, `GEMINI_API_KEY`, `DEEPSEEK_API_KEY` hoặc `ANTHROPIC_API_KEY`).

3. **Khởi động hạ tầng local (PostgreSQL, Redis, Python sandbox):**
   ```bash
   pnpm local:up
   ```

4. **Đồng bộ Prisma schema:**
   ```bash
   pnpm --filter @agent/core prisma:generate
   pnpm --filter @agent/core prisma:push
   ```

5. **Chạy hệ thống:**
   ```bash
   # Chạy đồng thời @agent/core (dev) và Web Playground
   pnpm dev

   # Hoặc chạy riêng từng phần:
   pnpm --filter @agent/core start:dev   # API & Engine mặc định tại http://localhost:3000
   pnpm cli                              # CLI REPL tương tác trên terminal
   pnpm cli:web                          # Web Playground
   ```

---

## Kiểm thử & Kiểm tra chất lượng

```bash
pnpm arch         # Kiểm tra vòng phụ thuộc & thứ tự layer (dependency-cruiser)
pnpm typecheck    # Kiểm tra TypeScript toàn workspace
pnpm test         # Chạy Jest test suites (@agent/core & @agent/cli)
pnpm boot:check   # Boot thử NestJS app thật (yêu cầu Postgres/Redis đang chạy)
pnpm build        # Build toàn bộ workspace
```

---

## Tài liệu tham khảo thêm

- [docs/README.md](docs/README.md) — Thứ tự đọc tài liệu chuẩn trong dự án
- [docs/architecture-7-layers.md](docs/architecture-7-layers.md) — Chi tiết kiến trúc 7 layer
- [docs/streaming-and-queue-architecture.md](docs/streaming-and-queue-architecture.md) — Kiến trúc BullMQ, Pub/Sub và SSE Streaming
- [specs/_workflow.md](specs/_workflow.md) — Quy trình Spec-Driven Development (SDD)
