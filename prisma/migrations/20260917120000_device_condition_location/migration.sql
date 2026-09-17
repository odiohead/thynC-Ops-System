-- 기기 상태·위치 축 (2026-09-17 — projects/device_condition_location_design.md §5): 3축 = 배치(hospital_devices, 불변) / 상태 condition·위치 location(device_units, B-26)
-- 거점 마스터는 status_codes DEVICE_SITE(value가 시스템 의미). seed-device-registry.sql에도 동일 INSERT. 백필은 scripts/backfill-device-condition.mts(--dry/--apply)
-- 적용: psql "$DATABASE_URL" --single-transaction -v ON_ERROR_STOP=1 -f <this> → npx prisma migrate resolve --applied <dir> → npx prisma generate. 롤백 런북: 설계안 부록 A.0
-- DEV BEGIN…ROLLBACK 실측: 0.96s, 2회 연속 실행 오류 0(멱등)
SET lock_timeout = '5s';

-- 1) 거점 마스터
INSERT INTO status_codes (name, category, "order", value) VALUES
  ('리프레시센터','DEVICE_SITE',1,'REFRESH_CENTER'), ('thynC Connected Hub','DEVICE_SITE',2,'HUB')
ON CONFLICT (name, category) DO NOTHING;

-- 2) device_units — 상태·위치 (유닛 속성)
ALTER TABLE device_units
  ADD COLUMN IF NOT EXISTS condition TEXT,
  ADD COLUMN IF NOT EXISTS condition_changed_on DATE,
  ADD COLUMN IF NOT EXISTS location_hospital_code TEXT REFERENCES hospitals(hospital_code) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD COLUMN IF NOT EXISTS location_site_id INTEGER REFERENCES status_codes(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS location_changed_on DATE;
ALTER TABLE device_units DROP CONSTRAINT IF EXISTS device_units_condition_check;
ALTER TABLE device_units ADD CONSTRAINT device_units_condition_check
  CHECK (condition IS NULL OR condition IN ('IN_USE','AS_WAITING','REPAIRED','PRE_SHIP','LOST','SCRAPPED'));
ALTER TABLE device_units DROP CONSTRAINT IF EXISTS device_units_location_single_check;
ALTER TABLE device_units ADD CONSTRAINT device_units_location_single_check
  CHECK (location_hospital_code IS NULL OR location_site_id IS NULL);
ALTER TABLE device_units DROP CONSTRAINT IF EXISTS device_units_terminal_no_location_check;
ALTER TABLE device_units ADD CONSTRAINT device_units_terminal_no_location_check
  CHECK (condition IS NULL OR condition NOT IN ('LOST','SCRAPPED') OR (location_hospital_code IS NULL AND location_site_id IS NULL));
CREATE INDEX IF NOT EXISTS device_units_condition_idx         ON device_units(condition);
CREATE INDEX IF NOT EXISTS device_units_location_site_idx     ON device_units(location_site_id, condition) WHERE location_site_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS device_units_location_hospital_idx ON device_units(location_hospital_code) WHERE location_hospital_code IS NOT NULL;

-- 3) 이벤트 어휘 확장 (CHECK는 DROP 후 재생성 — 20260911 선례) + 회수 기기(hospital_code NULL) 이벤트 허용 + 스냅샷 강제
ALTER TABLE hospital_device_events DROP CONSTRAINT IF EXISTS hospital_device_events_type_check;
ALTER TABLE hospital_device_events ADD CONSTRAINT hospital_device_events_type_check
  CHECK (event_type IN ('REGISTER','MOVE_WARD','RECOVER','CORRECT','AS_OPEN','AS_CLEAR','INTAKE','REPAIR_DONE','SCRAP','SITE_MOVE'));
ALTER TABLE hospital_device_events DROP CONSTRAINT IF EXISTS hospital_device_events_hospital_check;
ALTER TABLE hospital_device_events ADD CONSTRAINT hospital_device_events_hospital_check
  CHECK (event_type IN ('CORRECT','INTAKE','REPAIR_DONE','SCRAP','SITE_MOVE') OR hospital_code IS NOT NULL);
ALTER TABLE hospital_device_events DROP CONSTRAINT IF EXISTS hospital_device_events_changes_check;
ALTER TABLE hospital_device_events ADD CONSTRAINT hospital_device_events_changes_check
  CHECK (event_type NOT IN ('CORRECT','INTAKE','REPAIR_DONE','SCRAP','SITE_MOVE') OR changes IS NOT NULL);

-- 4) as_receipt_items — 수리완료 (outcome과 독립인 제3축)
ALTER TABLE as_receipt_items
  ADD COLUMN IF NOT EXISTS repaired_at DATE,
  ADD COLUMN IF NOT EXISTS repaired_by_id TEXT REFERENCES users(id) ON DELETE SET NULL ON UPDATE CASCADE;
