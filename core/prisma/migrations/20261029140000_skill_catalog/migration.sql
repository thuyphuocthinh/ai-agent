-- Skill Catalog & Progressive Disclosure
-- Bỏ cơ chế skill tự học: toàn bộ hàng cũ là skill episodic (steps/args thô) nên xóa, không backfill.
DELETE FROM "orchestration_skills";

-- Drop legacy columns
ALTER TABLE "orchestration_skills"
  DROP COLUMN IF EXISTS "task_description",
  DROP COLUMN IF EXISTS "summary_markdown",
  DROP COLUMN IF EXISTS "steps",
  DROP COLUMN IF EXISTS "source_checkpoint_ids",
  DROP COLUMN IF EXISTS "approved_run_count",
  DROP COLUMN IF EXISTS "risk_level";

-- Reshape tenant_id
ALTER TABLE "orchestration_skills"
  ALTER COLUMN "tenant_id" TYPE varchar(100),
  ALTER COLUMN "tenant_id" SET DEFAULT 'default';

-- Add catalog columns (bảng đã rỗng nên NOT NULL không cần backfill)
ALTER TABLE "orchestration_skills"
  ADD COLUMN "slug" varchar(100) NOT NULL,
  ADD COLUMN "name" varchar(150) NOT NULL,
  ADD COLUMN "description" text NOT NULL,
  ADD COLUMN "instructions" text NOT NULL,
  ADD COLUMN "tools" text[] NOT NULL DEFAULT ARRAY[]::text[],
  ADD COLUMN "tags" text[] NOT NULL DEFAULT ARRAY[]::text[],
  ADD COLUMN "is_active" boolean NOT NULL DEFAULT true,
  ADD COLUMN "metadata" jsonb NOT NULL DEFAULT '{}';

-- Indexes: slug unique theo tenant
DROP INDEX IF EXISTS "IDX_orchestration_skills_tenant_id";
CREATE UNIQUE INDEX "UQ_orchestration_skills_tenant_slug" ON "orchestration_skills" ("tenant_id", "slug");
CREATE INDEX "IDX_orchestration_skills_tenant_active" ON "orchestration_skills" ("tenant_id", "is_active");
