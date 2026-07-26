-- 1.1 알림체계 개선 P1 — SLA 시계 엔진 (projects/notification_v1.1_design.md §4.5)
-- 순수 추가 마이그레이션. 기존 테이블 변경 없음 (tickets.due_at은 RESOLVE/DOMAIN_DUE 시계의 캐시로 계속 사용)

-- ① SLA 정책 — "어떤 티켓에 적용되나" + 시계 성격
CREATE TABLE "sla_policies" (
  "id"          SERIAL PRIMARY KEY,
  "name"        VARCHAR(100) NOT NULL,
  "description" TEXT,
  "priority"    INTEGER NOT NULL DEFAULT 100,
  "ref_types"   TEXT[] NOT NULL DEFAULT '{}',
  "queue_ids"   INTEGER[] NOT NULL DEFAULT '{}',
  "cti_ids"     INTEGER[] NOT NULL DEFAULT '{}',
  "severities"  TEXT[] NOT NULL DEFAULT '{}',
  "clock_type"  VARCHAR(20) NOT NULL DEFAULT 'CALENDAR_24H',
  "is_active"   BOOLEAN NOT NULL DEFAULT true,
  "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "sla_policies_is_active_priority_idx" ON "sla_policies" ("is_active", "priority");

-- ② 정책별 목표 — "무엇을 몇 분 안에"
CREATE TABLE "sla_targets" (
  "id"            SERIAL PRIMARY KEY,
  "policy_id"     INTEGER NOT NULL REFERENCES "sla_policies"("id") ON DELETE CASCADE,
  "metric"        VARCHAR(20) NOT NULL,
  "status_scope"  VARCHAR(20),
  "severity"      VARCHAR(10),
  "threshold_min" INTEGER NOT NULL,
  "warn_ratio"    SMALLINT NOT NULL DEFAULT 80,
  "is_active"     BOOLEAN NOT NULL DEFAULT true,
  "created_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "sla_targets_threshold_chk" CHECK ("threshold_min" >= 0),
  CONSTRAINT "sla_targets_warn_chk" CHECK ("warn_ratio" >= 0 AND "warn_ratio" <= 100),
  CONSTRAINT "sla_targets_dwell_chk" CHECK ("metric" <> 'DWELL' OR "status_scope" IS NOT NULL)
);
-- 같은 정책에 (metric, 상태, Sev) 조합 중복 금지 — NULL은 빈 문자열로 정규화해 비교
CREATE UNIQUE INDEX "sla_targets_uniq" ON "sla_targets"
  ("policy_id", "metric", COALESCE("status_scope", ''), COALESCE("severity", ''));
CREATE INDEX "sla_targets_policy_idx" ON "sla_targets" ("policy_id");

-- ③ 티켓별 시계 — 알림·지표의 근거 (파생 데이터: 삭제 후 재백필 가능)
CREATE TABLE "ticket_sla_clocks" (
  "id"                 BIGSERIAL PRIMARY KEY,
  "ticket_id"          INTEGER NOT NULL REFERENCES "tickets"("id") ON DELETE CASCADE,
  "metric"             VARCHAR(20) NOT NULL,
  "status_scope"       VARCHAR(20),
  "policy_id"          INTEGER REFERENCES "sla_policies"("id") ON DELETE SET NULL,
  "target_id"          INTEGER REFERENCES "sla_targets"("id") ON DELETE SET NULL,
  "threshold_min"      INTEGER NOT NULL,
  "started_at"         TIMESTAMP(3) NOT NULL,
  "due_at"             TIMESTAMP(3) NOT NULL,
  "paused_at"          TIMESTAMP(3),
  "paused_ms"          BIGINT NOT NULL DEFAULT 0,
  "state"              VARCHAR(12) NOT NULL DEFAULT 'RUNNING',
  "satisfied_at"       TIMESTAMP(3),
  "breached_at"        TIMESTAMP(3),
  "notified_warn_at"   TIMESTAMP(3),
  "notified_breach_at" TIMESTAMP(3),
  "created_at"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "ticket_sla_clocks_uniq" ON "ticket_sla_clocks"
  ("ticket_id", "metric", COALESCE("status_scope", ''));
CREATE INDEX "ticket_sla_clocks_ticket_idx" ON "ticket_sla_clocks" ("ticket_id");
-- 초과 스캔 전용 부분 인덱스 (tick 부하 억제 — 아직 알리지 않은 진행 중 시계만)
CREATE INDEX "ticket_sla_clocks_scan_idx" ON "ticket_sla_clocks" ("state", "due_at")
  WHERE "state" = 'RUNNING' AND "notified_breach_at" IS NULL;
CREATE INDEX "ticket_sla_clocks_state_idx" ON "ticket_sla_clocks" ("state", "metric");
