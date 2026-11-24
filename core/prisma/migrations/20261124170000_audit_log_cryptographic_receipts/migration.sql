-- Migration: Add Cryptographic Receipts to Audit Log
-- Purpose: Biến bảng audit_logs thành sổ cái bất biến dạng hash-chaining có chữ ký số Ed25519

-- 1. Thêm các cột mật mã học mới vào bảng audit_logs
ALTER TABLE "audit_logs"
  ADD COLUMN IF NOT EXISTS "sequence_number" integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS "previous_receipt_hash" varchar(64) NOT NULL DEFAULT '0000000000000000000000000000000000000000000000000000000000000000',
  ADD COLUMN IF NOT EXISTS "current_receipt_hash" varchar(64) NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS "signature" varchar(128) NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS "key_id" varchar(100) NOT NULL DEFAULT 'agent-core-prod-v1';

-- 2. Backfill dữ liệu cũ (nếu có) để current_receipt_hash không bị rỗng
UPDATE "audit_logs"
SET "current_receipt_hash" = "fingerprint"
WHERE "current_receipt_hash" = '';

-- 3. Đánh chỉ mục Unique: Mỗi cuộc hội thoại (conversation_id) có sequence_number tăng dần và duy nhất
CREATE UNIQUE INDEX IF NOT EXISTS "uq_audit_conversation_sequence" 
  ON "audit_logs" ("conversation_id", "sequence_number");

-- 4. Đánh chỉ mục Index tra cứu nhanh hash phục vụ Auditor verification
CREATE INDEX IF NOT EXISTS "idx_audit_current_receipt_hash" 
  ON "audit_logs" ("current_receipt_hash");

CREATE INDEX IF NOT EXISTS "idx_audit_previous_receipt_hash" 
  ON "audit_logs" ("previous_receipt_hash");
