-- 1.1 P5 — 시스템 내부 알림 (projects/notification_v1.1_design.md §6)
-- 알림의 원본을 DB로 옮긴다. Slack은 이 중 일부를 밖으로 내보내는 어댑터이고,
-- 향후 페이저 앱도 같은 테이블을 소스로 쓴다.
-- 순수 추가 마이그레이션.

-- ⑥ 개인 알림함
CREATE TABLE "notifications" (
  "id"         BIGSERIAL PRIMARY KEY,
  "user_id"    TEXT NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "kind"       VARCHAR(40) NOT NULL,
  "title"      VARCHAR(200) NOT NULL,
  "body"       TEXT,
  "link"       VARCHAR(300) NOT NULL,
  -- 티켓은 FK 없이 ID만 보관 — 티켓이 삭제돼도 알림 이력은 남는다(ai_usage_logs 선례)
  "ticket_id"  INTEGER,
  "ref_type"   VARCHAR(20),
  "ref_code"   VARCHAR(50),
  "severity"   VARCHAR(10),
  "actor_id"   TEXT REFERENCES "users"("id") ON DELETE SET NULL,
  "actor_name" VARCHAR(60),               -- 스냅샷 (계정 삭제 후에도 표시)
  "dedup_key"  VARCHAR(200),
  "read_at"    TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "notifications_user_idx" ON "notifications" ("user_id", "read_at", "created_at" DESC);
CREATE INDEX "notifications_user_created_idx" ON "notifications" ("user_id", "created_at" DESC);
CREATE INDEX "notifications_ticket_idx" ON "notifications" ("ticket_id");
-- 같은 사건이 두 번 적재되지 않게 (부분 UNIQUE — dedup_key 없는 알림은 제한 없음)
CREATE UNIQUE INDEX "notifications_dedup_uniq" ON "notifications" ("dedup_key") WHERE "dedup_key" IS NOT NULL;

-- ⑦ 개인 알림 수신 설정 — 행이 없으면 코드 기본값 적용(계정마다 미리 만들지 않는다)
CREATE TABLE "notification_prefs" (
  "user_id"  TEXT NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "kind"     VARCHAR(40) NOT NULL,
  "in_app"   BOOLEAN NOT NULL DEFAULT true,
  "slack_dm" BOOLEAN NOT NULL DEFAULT false,
  PRIMARY KEY ("user_id", "kind")
);
