-- 주간업무 관리툴 (2026-08-19) — 관리 항목 + 주차별 진행 + 주간 메모 (projects/weekly_ops_design.md)
-- 상태·구분 값은 lib/weekly.ts 코드 상수 (DB 마스터 아님)

CREATE TABLE weekly_items (
  id SERIAL PRIMARY KEY,
  kind TEXT NOT NULL,                       -- 'PROJECT' | 'ISSUE'
  title TEXT NOT NULL,
  detail TEXT,
  status TEXT NOT NULL DEFAULT '진행',       -- '진행' | '보류' (완료는 completed_week로 판정 — 단일 소스)
  hospital_code TEXT REFERENCES hospitals(hospital_code) ON DELETE SET NULL,
  project_code TEXT REFERENCES projects(project_code) ON DELETE SET NULL,
  owner_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  target_date DATE,
  completed_week DATE,                      -- 완료 주차(월요일) — NULL이면 미완료 (완료 여부 단일 소스)
  completed_at TIMESTAMP(3),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP(3) NOT NULL
);
CREATE INDEX weekly_items_kind_idx ON weekly_items(kind);
CREATE INDEX weekly_items_hospital_code_idx ON weekly_items(hospital_code);
CREATE INDEX weekly_items_status_idx ON weekly_items(status);

CREATE TABLE weekly_item_updates (
  id SERIAL PRIMARY KEY,
  item_id INTEGER NOT NULL REFERENCES weekly_items(id) ON DELETE CASCADE,
  week_start DATE NOT NULL,                 -- 주차 키(월요일)
  content TEXT NOT NULL,
  updated_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP(3) NOT NULL,
  UNIQUE (item_id, week_start)
);
CREATE INDEX weekly_item_updates_week_start_idx ON weekly_item_updates(week_start);

CREATE TABLE weekly_week_notes (
  id SERIAL PRIMARY KEY,
  week_start DATE NOT NULL UNIQUE,
  content TEXT NOT NULL DEFAULT '',
  updated_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP(3) NOT NULL
);
