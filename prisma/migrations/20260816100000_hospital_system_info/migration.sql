-- thynC 시스템 현황 카드 보강 (2026-08-16) — 병원 서버 현황 + EMR 연동 정보
-- EMR 업체 마스터는 status_codes EMR_VENDOR 카테고리 (별도 시드 불요 — 설정 화면에서 관리)

CREATE TABLE hospital_servers (
  id             SERIAL PRIMARY KEY,
  hospital_code  TEXT NOT NULL REFERENCES hospitals(hospital_code) ON DELETE CASCADE,
  name           TEXT NOT NULL,
  ward_info      TEXT,
  monitoring_url TEXT,
  remote_url     TEXT,
  sort_order     INTEGER NOT NULL DEFAULT 0,
  created_at     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     TIMESTAMP(3) NOT NULL
);

CREATE INDEX hospital_servers_hospital_code_idx ON hospital_servers(hospital_code);

CREATE TABLE hospital_emr_info (
  id            SERIAL PRIMARY KEY,
  hospital_code TEXT NOT NULL UNIQUE REFERENCES hospitals(hospital_code) ON DELETE CASCADE,
  link_status   TEXT NOT NULL DEFAULT '미연동',
  emr_vendor_id INTEGER REFERENCES status_codes(id) ON DELETE SET NULL,
  data_scopes   TEXT[] NOT NULL DEFAULT '{}',
  link_methods  TEXT[] NOT NULL DEFAULT '{}',
  memo          TEXT,
  created_at    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP(3) NOT NULL
);
