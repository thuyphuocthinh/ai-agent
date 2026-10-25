-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Function: uuid_generate_v7()
CREATE OR REPLACE FUNCTION uuid_generate_v7()
RETURNS uuid
AS $$
DECLARE
  v_time timestamp with time zone := clock_timestamp();
  v_epoch_ms bigint := (extract(epoch from v_time) * 1000)::bigint;
  v_bytes bytea := gen_random_bytes(16);
BEGIN
  -- set 48 bits of timestamp
  v_bytes := set_byte(v_bytes, 0, ((v_epoch_ms >> 40) & 255)::int);
  v_bytes := set_byte(v_bytes, 1, ((v_epoch_ms >> 32) & 255)::int);
  v_bytes := set_byte(v_bytes, 2, ((v_epoch_ms >> 24) & 255)::int);
  v_bytes := set_byte(v_bytes, 3, ((v_epoch_ms >> 16) & 255)::int);
  v_bytes := set_byte(v_bytes, 4, ((v_epoch_ms >> 8) & 255)::int);
  v_bytes := set_byte(v_bytes, 5, (v_epoch_ms & 255)::int);
  -- version 7
  v_bytes := set_byte(v_bytes, 6, ((get_byte(v_bytes, 6) & 15) | 112)::int);
  -- variant RFC 4122 / 9562
  v_bytes := set_byte(v_bytes, 8, ((get_byte(v_bytes, 8) & 63) | 128)::int);
  RETURN encode(v_bytes, 'hex')::uuid;
END;
$$ LANGUAGE plpgsql VOLATILE;

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'STAFF', 'USER', 'GUEST');

-- CreateEnum
CREATE TYPE "ConversationState" AS ENUM ('AI_ACTIVE', 'WAITING_FOR_APPROVAL', 'HUMAN_TAKEOVER');

-- CreateEnum
CREATE TYPE "MessageRole" AS ENUM ('USER', 'ASSISTANT', 'SYSTEM');

-- CreateEnum
CREATE TYPE "CheckpointKind" AS ENUM ('APPROVAL', 'CLARIFICATION');

-- CreateEnum
CREATE TYPE "CheckpointStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "AuditStatus" AS ENUM ('EXECUTED', 'BLOCKED', 'PENDING_APPROVAL', 'REJECTED');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "email" VARCHAR(255),
    "full_name" VARCHAR(150),
    "avatar_url" VARCHAR(500),
    "role" "UserRole" NOT NULL DEFAULT 'USER',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "metadata" JSONB DEFAULT '{}',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auths" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "user_id" UUID NOT NULL,
    "provider" VARCHAR(50) NOT NULL DEFAULT 'local',
    "provider_id" VARCHAR(100),
    "password_hash" VARCHAR(255),
    "refresh_token_hash" VARCHAR(255),
    "token_expires_at" TIMESTAMPTZ,
    "last_login_at" TIMESTAMPTZ,
    "failed_login_attempts" INTEGER NOT NULL DEFAULT 0,
    "locked_until" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "auths_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversations" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "user_id" UUID NOT NULL,
    "workflow_id" UUID,
    "title" VARCHAR(200) DEFAULT 'Cuộc trò chuyện mới',
    "channel_type" VARCHAR(50) NOT NULL DEFAULT 'web',
    "channel_id" VARCHAR(100),
    "workspace_id" VARCHAR(100) NOT NULL DEFAULT 'default',
    "bot_user_id" VARCHAR(100),
    "state" "ConversationState" NOT NULL DEFAULT 'AI_ACTIVE',
    "approval_message_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "metadata" JSONB DEFAULT '{}',
    "last_seen_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversation_messages" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "conversation_id" UUID NOT NULL,
    "sender_id" VARCHAR(100),
    "role" "MessageRole" NOT NULL,
    "text" TEXT NOT NULL,
    "is_text" BOOLEAN NOT NULL DEFAULT true,
    "attachments" JSONB DEFAULT '[]',
    "model_used" VARCHAR(100),
    "input_tokens" INTEGER,
    "output_tokens" INTEGER,
    "cost_usd" DOUBLE PRECISION,
    "latency_ms" INTEGER,
    "metadata" JSONB DEFAULT '{}',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conversation_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "orchestration_checkpoints" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "reply_message_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "workspace_id" VARCHAR(100) NOT NULL DEFAULT 'default',
    "session_type" VARCHAR(50) NOT NULL DEFAULT 'web',
    "original_prompt" TEXT NOT NULL,
    "pending_tool" JSONB,
    "pending_task" TEXT NOT NULL,
    "kind" "CheckpointKind" NOT NULL DEFAULT 'APPROVAL',
    "risk_level" VARCHAR(50),
    "clarification_question" TEXT,
    "clarification_candidates" JSONB,
    "selected_provider" VARCHAR(100),
    "rounds_so_far" JSONB NOT NULL DEFAULT '[]',
    "remaining_steps" JSONB NOT NULL DEFAULT '[]',
    "history" JSONB NOT NULL DEFAULT '[]',
    "status" "CheckpointStatus" NOT NULL DEFAULT 'PENDING',
    "expires_at" TIMESTAMPTZ NOT NULL,
    "execution_started_at" TIMESTAMPTZ,
    "tool_executed_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "orchestration_checkpoints_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "orchestration_trigger_claims" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "trigger_message_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "orchestration_trigger_claims_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflows" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "slug" VARCHAR(100) NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "description" TEXT,
    "system_prompt" TEXT NOT NULL,
    "model" VARCHAR(100) DEFAULT 'gemini-2.0-flash',
    "tools" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "require_approval_for" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "max_loops" INTEGER DEFAULT 5,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "metadata" JSONB DEFAULT '{}',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "workflows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversation_memories" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "conversation_id" UUID NOT NULL,
    "source_message_id" UUID NOT NULL,
    "tool" VARCHAR(100) NOT NULL,
    "content" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conversation_memories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "timestamp" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "user_id" UUID,
    "conversation_id" UUID,
    "provider" VARCHAR(100) NOT NULL,
    "tool_name" VARCHAR(100) NOT NULL,
    "action_type" VARCHAR(50) NOT NULL,
    "fingerprint" VARCHAR(64) NOT NULL,
    "input_args" JSONB NOT NULL,
    "result_preview" TEXT,
    "verdict" VARCHAR(50) NOT NULL,
    "cited_rule_id" VARCHAR(100),
    "status" "AuditStatus" NOT NULL DEFAULT 'EXECUTED',
    "metadata" JSONB DEFAULT '{}',

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- Compatibility Table for Dynamic OpenAPI tools
CREATE TABLE IF NOT EXISTS "orchestration_dynamic_providers" (
  "id" character varying NOT NULL,
  "user_id" character varying NOT NULL,
  "name" character varying NOT NULL,
  "spec_url" text NOT NULL,
  "description" text,
  "access_token" text,
  "auth_type" character varying(50) NOT NULL DEFAULT 'BEARER',
  "refresh_token" text,
  "token_expires_at" timestamptz,
  "auth_config" jsonb,
  "is_active" boolean NOT NULL DEFAULT true,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "PK_orchestration_dynamic_providers" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "idx_dyn_prov_user_id" ON "orchestration_dynamic_providers" ("user_id");

-- Compatibility Table for Learned Skills
CREATE TABLE IF NOT EXISTS "orchestration_skills" (
  "id" uuid NOT NULL DEFAULT uuid_generate_v7(),
  "tenant_id" varchar(36) NOT NULL,
  "task_description" text NOT NULL,
  "summary_markdown" text NOT NULL,
  "steps" jsonb NOT NULL,
  "source_checkpoint_ids" jsonb NOT NULL DEFAULT '[]',
  "approved_run_count" int NOT NULL DEFAULT 1,
  "risk_level" character varying,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "PK_orchestration_skills" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "IDX_orchestration_skills_tenant_id" ON "orchestration_skills" ("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "auths_user_id_key" ON "auths"("user_id");

-- CreateIndex
CREATE INDEX "auths_provider_provider_id_idx" ON "auths"("provider", "provider_id");

-- CreateIndex
CREATE INDEX "conversations_user_id_updated_at_idx" ON "conversations"("user_id", "updated_at" DESC);

-- CreateIndex
CREATE INDEX "conversations_channel_type_channel_id_idx" ON "conversations"("channel_type", "channel_id");

-- CreateIndex
CREATE INDEX "conversation_messages_conversation_id_created_at_idx" ON "conversation_messages"("conversation_id", "created_at" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "orchestration_checkpoints_reply_message_id_key" ON "orchestration_checkpoints"("reply_message_id");

-- CreateIndex
CREATE INDEX "orchestration_checkpoints_user_id_status_idx" ON "orchestration_checkpoints"("user_id", "status");

-- CreateIndex
CREATE INDEX "orchestration_checkpoints_expires_at_idx" ON "orchestration_checkpoints"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "orchestration_trigger_claims_trigger_message_id_key" ON "orchestration_trigger_claims"("trigger_message_id");

-- CreateIndex
CREATE UNIQUE INDEX "workflows_slug_key" ON "workflows"("slug");

-- CreateIndex
CREATE INDEX "conversation_memories_conversation_id_idx" ON "conversation_memories"("conversation_id");

-- CreateIndex
CREATE INDEX "audit_logs_timestamp_idx" ON "audit_logs"("timestamp" DESC);

-- CreateIndex
CREATE INDEX "audit_logs_user_id_timestamp_idx" ON "audit_logs"("user_id", "timestamp" DESC);

-- CreateIndex
CREATE INDEX "audit_logs_fingerprint_idx" ON "audit_logs"("fingerprint");

-- CreateIndex
CREATE INDEX "audit_logs_cited_rule_id_idx" ON "audit_logs"("cited_rule_id");

-- AddForeignKey
ALTER TABLE "auths" ADD CONSTRAINT "auths_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_workflow_id_fkey" FOREIGN KEY ("workflow_id") REFERENCES "workflows"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_messages" ADD CONSTRAINT "conversation_messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orchestration_checkpoints" ADD CONSTRAINT "orchestration_checkpoints_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orchestration_checkpoints" ADD CONSTRAINT "orchestration_checkpoints_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_memories" ADD CONSTRAINT "conversation_memories_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
