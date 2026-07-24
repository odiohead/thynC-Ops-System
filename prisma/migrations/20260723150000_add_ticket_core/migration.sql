-- 티켓 시스템 P1: 코어 테이블 6종 + enum 2종 (ticket_dev_schedule.md P1 상세 설계)

CREATE TYPE "ticket_status" AS ENUM ('OPEN', 'ASSIGNED', 'IN_PROGRESS', 'PENDING', 'RESOLVED', 'CLOSED');
CREATE TYPE "ticket_severity" AS ENUM ('SEV1', 'SEV2', 'SEV3', 'SEV4', 'SEV5');

CREATE TABLE "ticket_queues" (
    "id" SERIAL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "ticket_queues_name_key" ON "ticket_queues"("name");

CREATE TABLE "ticket_cti" (
    "id" SERIAL PRIMARY KEY,
    "parent_id" INTEGER,
    "level" SMALLINT NOT NULL,
    "name" TEXT NOT NULL,
    "default_queue_id" INTEGER,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ticket_cti_level_check" CHECK ("level" BETWEEN 1 AND 3),
    CONSTRAINT "ticket_cti_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "ticket_cti"("id") ON DELETE CASCADE,
    CONSTRAINT "ticket_cti_default_queue_id_fkey" FOREIGN KEY ("default_queue_id") REFERENCES "ticket_queues"("id") ON DELETE SET NULL
);
CREATE UNIQUE INDEX "ticket_cti_parent_id_name_key" ON "ticket_cti"("parent_id", "name");
CREATE INDEX "ticket_cti_parent_id_sort_order_idx" ON "ticket_cti"("parent_id", "sort_order");

CREATE TABLE "ticket_pending_reasons" (
    "id" SERIAL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "ticket_pending_reasons_name_key" ON "ticket_pending_reasons"("name");

CREATE TABLE "tickets" (
    "id" SERIAL PRIMARY KEY,
    "ticket_code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description_html" TEXT,
    "status" "ticket_status" NOT NULL DEFAULT 'OPEN',
    "severity" "ticket_severity" NOT NULL DEFAULT 'SEV4',
    "queue_id" INTEGER NOT NULL,
    "cti_id" INTEGER,
    "owner_id" TEXT,
    "pending_reason_id" INTEGER,
    "pending_note" TEXT,
    "hospital_code" TEXT,
    "status_changed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMP(3),
    "closed_at" TIMESTAMP(3),
    "reopen_count" INTEGER NOT NULL DEFAULT 0,
    "due_at" TIMESTAMP(3),
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "tickets_queue_id_fkey" FOREIGN KEY ("queue_id") REFERENCES "ticket_queues"("id"),
    CONSTRAINT "tickets_cti_id_fkey" FOREIGN KEY ("cti_id") REFERENCES "ticket_cti"("id") ON DELETE SET NULL,
    CONSTRAINT "tickets_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE SET NULL,
    CONSTRAINT "tickets_pending_reason_id_fkey" FOREIGN KEY ("pending_reason_id") REFERENCES "ticket_pending_reasons"("id") ON DELETE SET NULL,
    CONSTRAINT "tickets_hospital_code_fkey" FOREIGN KEY ("hospital_code") REFERENCES "hospitals"("hospital_code") ON DELETE SET NULL,
    CONSTRAINT "tickets_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL
);
CREATE UNIQUE INDEX "tickets_ticket_code_key" ON "tickets"("ticket_code");
CREATE INDEX "tickets_queue_id_status_idx" ON "tickets"("queue_id", "status");
CREATE INDEX "tickets_owner_id_status_idx" ON "tickets"("owner_id", "status");
CREATE INDEX "tickets_severity_idx" ON "tickets"("severity");
CREATE INDEX "tickets_status_changed_at_idx" ON "tickets"("status_changed_at");
CREATE INDEX "tickets_hospital_code_idx" ON "tickets"("hospital_code");

CREATE TABLE "ticket_participants" (
    "id" SERIAL PRIMARY KEY,
    "ticket_id" INTEGER NOT NULL,
    "user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ticket_participants_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "tickets"("id") ON DELETE CASCADE,
    CONSTRAINT "ticket_participants_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX "ticket_participants_ticket_id_user_id_key" ON "ticket_participants"("ticket_id", "user_id");

CREATE TABLE "ticket_logs" (
    "id" SERIAL PRIMARY KEY,
    "ticket_id" INTEGER NOT NULL,
    "log_type" TEXT NOT NULL,
    "author_id" TEXT,
    "content_html" TEXT,
    "payload" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ticket_logs_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "tickets"("id") ON DELETE CASCADE,
    CONSTRAINT "ticket_logs_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE SET NULL
);
CREATE INDEX "ticket_logs_ticket_id_created_at_idx" ON "ticket_logs"("ticket_id", "created_at");
