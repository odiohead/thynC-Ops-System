-- 영업/CRM v4 P1 — 병원 축: 인적정보(인물/소속 이력) + 프로필 정리 (sales_crm_design.md v4 §3.1~3.2)
-- hospital_contacts는 0행 상태에서 DROP — 데이터 유실 없음

CREATE TABLE persons (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  person_group_id INTEGER REFERENCES status_codes(id) ON DELETE SET NULL,
  specialty TEXT,
  phone TEXT,
  email TEXT,
  memo TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE person_affiliations (
  id SERIAL PRIMARY KEY,
  person_id INTEGER NOT NULL REFERENCES persons(id) ON DELETE CASCADE,
  hospital_code TEXT NOT NULL REFERENCES hospitals(hospital_code) ON DELETE CASCADE,
  title TEXT,
  department TEXT,
  is_primary BOOLEAN NOT NULL DEFAULT false,
  is_current BOOLEAN NOT NULL DEFAULT true,
  started_on DATE,
  ended_on DATE,
  note TEXT,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX person_affiliations_hospital_code_is_current_idx ON person_affiliations(hospital_code, is_current);
CREATE INDEX person_affiliations_person_id_idx ON person_affiliations(person_id);

DROP TABLE IF EXISTS hospital_contacts;

ALTER TABLE hospital_sales_profiles
  DROP COLUMN IF EXISTS next_action,
  DROP COLUMN IF EXISTS next_action_date;
