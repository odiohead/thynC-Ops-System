-- 병원 태그 (2026-09-28) — 엄격히 정의된 마스터(hospital_tags) + 병원 N:M 부여(hospital_tag_assignments)
-- 마스터 생성·수정은 ADMIN/시드, 부여(체크)는 USER 이상. 시스템 키(key)가 있는 태그는 코드가 참조(예: AS접수 선교체 기본값)

CREATE TABLE IF NOT EXISTS hospital_tags (
  id           SERIAL PRIMARY KEY,
  key          VARCHAR(50) NOT NULL UNIQUE,        -- 시스템 키 (코드 참조용, 불변)
  name         VARCHAR(50) NOT NULL UNIQUE,        -- 표시명
  description  TEXT,                               -- 언제 부여하는지
  effect_note  TEXT,                               -- 시스템 동작에 미치는 효과 (없으면 정보성 라벨)
  color        VARCHAR(20) NOT NULL DEFAULT '#6B7280',
  is_system    BOOLEAN NOT NULL DEFAULT false,     -- true: 삭제·키 변경 금지 (코드가 참조)
  is_active    BOOLEAN NOT NULL DEFAULT true,
  sort_order   INTEGER NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS hospital_tag_assignments (
  id             SERIAL PRIMARY KEY,
  hospital_code  TEXT NOT NULL REFERENCES hospitals(hospital_code) ON DELETE CASCADE,
  tag_id         INTEGER NOT NULL REFERENCES hospital_tags(id) ON DELETE RESTRICT,
  note           TEXT,                              -- 부여 근거 (v1 UI 미노출, 스키마 예약)
  assigned_by_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  assigned_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (hospital_code, tag_id)
);
CREATE INDEX IF NOT EXISTS hospital_tag_assignments_tag_id_idx ON hospital_tag_assignments (tag_id);
