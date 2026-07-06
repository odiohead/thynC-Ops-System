-- 단계(상태) 체류 지연 감지용: 현재 상태로 진입한 시각 (function_notification.md 추가기능)
-- 기존 행은 NULL(진입 시각 불명 → 판정 시 앵커일 fallback), 신규 행은 생성 시각
-- DEFAULT를 나중에 SET 하여 기존 행 backfill을 피함 (PG fast-default 방지)

ALTER TABLE "public"."projects" ADD COLUMN "status_changed_at" TIMESTAMP(3);
ALTER TABLE "public"."projects" ALTER COLUMN "status_changed_at" SET DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "public"."site_visits" ADD COLUMN "status_changed_at" TIMESTAMP(3);
ALTER TABLE "public"."site_visits" ALTER COLUMN "status_changed_at" SET DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "public"."maintenances" ADD COLUMN "status_changed_at" TIMESTAMP(3);
ALTER TABLE "public"."maintenances" ALTER COLUMN "status_changed_at" SET DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "public"."etc_tasks" ADD COLUMN "status_changed_at" TIMESTAMP(3);
ALTER TABLE "public"."etc_tasks" ALTER COLUMN "status_changed_at" SET DEFAULT CURRENT_TIMESTAMP;
