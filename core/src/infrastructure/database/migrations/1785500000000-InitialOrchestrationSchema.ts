import { MigrationInterface, QueryRunner } from 'typeorm';

export class InitialOrchestrationSchema1785500000000 implements MigrationInterface {
  name = 'InitialOrchestrationSchema1785500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp";`);

    // 1. Status enum for HITL checkpoints
    await queryRunner.query(
      `CREATE TYPE "orchestration_checkpoints_status_enum" AS ENUM ('pending', 'approved', 'rejected')`,
    );

    // 2. Table: conversation_memory (extracted stable entities & facts per conversation)
    await queryRunner.query(`
      CREATE TABLE "conversation_memory" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "conversation_id" uuid NOT NULL,
        "source_message_id" uuid NOT NULL,
        "tool" varchar NOT NULL,
        "content" text NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_conversation_memory" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_conversation_memory_conversation_id" ON "conversation_memory" ("conversation_id")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_conversation_memory_source_message_content" ON "conversation_memory" ("source_message_id", "content")`,
    );

    // 3. Table: orchestration_checkpoints (HITL pause/resume snapshots)
    await queryRunner.query(`
      CREATE TABLE "orchestration_checkpoints" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "reply_message_id" uuid NOT NULL,
        "user_id" uuid NOT NULL,
        "agent_id" uuid,
        "conversation_id" uuid NOT NULL,
        "tenant_id" uuid NOT NULL,
        "session_type" character varying NOT NULL,
        "original_prompt" text NOT NULL,
        "pending_tool" jsonb,
        "pending_task" text NOT NULL,
        "kind" character varying NOT NULL DEFAULT 'approval',
        "risk_level" character varying,
        "clarification_question" text,
        "clarification_candidates" jsonb,
        "selected_provider" character varying,
        "rounds_so_far" jsonb NOT NULL DEFAULT '[]',
        "remaining_steps" jsonb NOT NULL DEFAULT '[]',
        "history" jsonb NOT NULL DEFAULT '[]',
        "status" "orchestration_checkpoints_status_enum" NOT NULL DEFAULT 'pending',
        "expires_at" timestamptz NOT NULL,
        "execution_started_at" timestamptz,
        "tool_executed_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_orchestration_checkpoints_reply_message_id" UNIQUE ("reply_message_id"),
        CONSTRAINT "PK_orchestration_checkpoints" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_orchestration_checkpoints_user_id" ON "orchestration_checkpoints" ("user_id")`,
    );

    // 4. Table: orchestration_skills (learned workflows)
    await queryRunner.query(`
      CREATE TABLE "orchestration_skills" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "tenant_id" uuid NOT NULL,
        "task_description" text NOT NULL,
        "summary_markdown" text NOT NULL,
        "steps" jsonb NOT NULL,
        "source_checkpoint_ids" jsonb NOT NULL DEFAULT '[]',
        "approved_run_count" int NOT NULL DEFAULT 1,
        "risk_level" character varying,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_orchestration_skills" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_orchestration_skills_tenant_id" ON "orchestration_skills" ("tenant_id")`,
    );

    // 5. Table: orchestration_dynamic_providers (OpenAPI custom user-registered tools)
    await queryRunner.query(`
      CREATE TABLE "orchestration_dynamic_providers" (
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
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_dyn_prov_user_id" ON "orchestration_dynamic_providers" ("user_id")`,
    );

    // 6. Table: orchestration_trigger_claims (atomic idempotency lock)
    await queryRunner.query(`
      CREATE TABLE "orchestration_trigger_claims" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "trigger_message_id" uuid NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_orchestration_trigger_claims_message" UNIQUE ("trigger_message_id"),
        CONSTRAINT "PK_orchestration_trigger_claims" PRIMARY KEY ("id")
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "orchestration_trigger_claims"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "orchestration_dynamic_providers"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "orchestration_skills"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "orchestration_checkpoints"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "orchestration_checkpoints_status_enum"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "conversation_memory"`);
  }
}
