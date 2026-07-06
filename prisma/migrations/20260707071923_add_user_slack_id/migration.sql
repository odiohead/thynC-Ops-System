-- 담당자 Slack DM 매핑용 (function_notification.md Phase 4)
-- users.email = Slack 이메일로 자동 매핑 후 캐시 저장. 매핑 실패 시 NULL 유지
ALTER TABLE "public"."users" ADD COLUMN "slack_user_id" VARCHAR(20);
