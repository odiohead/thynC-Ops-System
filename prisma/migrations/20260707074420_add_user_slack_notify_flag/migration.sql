-- 계정별 Slack 발송 유무 플래그 (function_notification.md — 계정 opt-out)
-- 기본 true(발송). false면 해당 계정에게 DM 미발송(테스트·수신거부용)
ALTER TABLE "public"."users" ADD COLUMN "slack_notify_enabled" BOOLEAN NOT NULL DEFAULT true;
