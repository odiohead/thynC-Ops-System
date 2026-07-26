-- 1.1 P3 — Slack 채널 라우팅 (projects/notification_v1.1_design.md §5.1)
-- 채널을 env 상수(SLACK_CHANNEL_MAIN/DELAY)에서 DB로 옮겨, 이벤트×조건 → 채널 N개 라우팅을 런타임 관리한다.
-- 순수 추가 마이그레이션. 시드(scripts/seed-notify-routes.sql)가 기존 동작(단일 채널)을 규칙 3행으로 재현한다.

-- ④ 발송 채널 마스터
CREATE TABLE "notify_channels" (
  "id"               SERIAL PRIMARY KEY,
  "name"             VARCHAR(60) NOT NULL,
  "slack_channel_id" VARCHAR(40) NOT NULL,
  "description"      TEXT,
  "is_active"        BOOLEAN NOT NULL DEFAULT true,
  "sort_order"       INTEGER NOT NULL DEFAULT 0,
  "created_at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "notify_channels_name_key" ON "notify_channels" ("name");

-- ⑤ 라우팅 규칙 — 매칭 축은 SLA 정책과 동일 의미론(축 간 AND, 배열 내부 OR, 빈 배열=전체)
--    단 정책과 달리 "매칭된 규칙 전부 실행" (다중 채널이 요구사항) · 같은 채널 중복은 발송 시 1건으로 합침
CREATE TABLE "notify_routes" (
  "id"           SERIAL PRIMARY KEY,
  "name"         VARCHAR(100) NOT NULL,
  "event_type"   VARCHAR(30) NOT NULL,
  "channel_id"   INTEGER NOT NULL REFERENCES "notify_channels"("id") ON DELETE CASCADE,
  "ref_types"    TEXT[] NOT NULL DEFAULT '{}',
  "queue_ids"    INTEGER[] NOT NULL DEFAULT '{}',
  "cti_ids"      INTEGER[] NOT NULL DEFAULT '{}',
  "severities"   TEXT[] NOT NULL DEFAULT '{}',
  "status_to"    TEXT[] NOT NULL DEFAULT '{}',   -- 상태변경 이벤트: "이 상태로 바뀔 때만"
  "metrics"      TEXT[] NOT NULL DEFAULT '{}',   -- SLA 이벤트: 대상 metric 한정
  "mention_mode" VARCHAR(20) NOT NULL DEFAULT 'none', -- none|queue_members|channel|here
  "digest_hour"  SMALLINT,                       -- DAILY_DIGEST 전용 (KST 0~23)
  "digest_opts"  JSONB,                          -- { kinds:[overdue,warning], groupBy, maxPerSection }
  "is_active"    BOOLEAN NOT NULL DEFAULT true,
  "sort_order"   INTEGER NOT NULL DEFAULT 0,
  "created_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "notify_routes_digest_hour_chk" CHECK ("digest_hour" IS NULL OR ("digest_hour" >= 0 AND "digest_hour" <= 23))
);
CREATE INDEX "notify_routes_event_idx" ON "notify_routes" ("event_type", "is_active");
CREATE INDEX "notify_routes_channel_idx" ON "notify_routes" ("channel_id");
