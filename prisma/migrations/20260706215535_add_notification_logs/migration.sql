-- Slack 알림 발송 이력 (function_notification.md Phase 1)
-- 이벤트/지연 알림 발송 기록 + 중복 발송 방지(dedup)의 근거 테이블

CREATE TABLE "public"."notification_logs" (
    "id" SERIAL NOT NULL,
    "event_type" VARCHAR(30) NOT NULL,
    "task_type" VARCHAR(20),
    "ref_code" VARCHAR(50),
    "target_type" VARCHAR(10) NOT NULL,
    "target_id" VARCHAR(50) NOT NULL,
    "status" VARCHAR(10) NOT NULL,
    "error" TEXT,
    "payload" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "notification_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "notification_logs_event_ref_target_created_idx" ON "public"."notification_logs"("event_type", "ref_code", "target_id", "created_at");
CREATE INDEX "notification_logs_created_at_idx" ON "public"."notification_logs"("created_at");
