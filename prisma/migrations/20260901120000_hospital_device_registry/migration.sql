-- 병원별 웨어러블 디바이스 원장 (projects/hospital_device_registry_design.md 부록 A.1)
-- 파괴적 마이그: 기존 hospital_devices(병원×모델 수량)를 같은 DB에 백업 후 DROP → 시리얼 개체 테이블이 이름 승계(D1)
-- 적용: psql "$DATABASE_URL" --single-transaction -v ON_ERROR_STOP=1 -f <this file> → npx prisma migrate resolve --applied 20260901120000_hospital_device_registry
-- 롤백 런북: 설계안 부록 A.0 ②

-- 1) D1: 수량표 백업(같은 DB) 후 DROP — 백업 테이블은 원장이 채워진 뒤 후속 마이그에서 삭제
CREATE TABLE hospital_devices_qty_backup_202609 AS SELECT * FROM hospital_devices;
DROP TABLE hospital_devices;

-- 2) D2: device_info 확장 (DDL — seed 스크립트에는 넣지 않음)
ALTER TABLE device_info
  ADD COLUMN device_class TEXT NOT NULL DEFAULT 'WEARABLE', ADD COLUMN onprem_device_type INTEGER, ADD COLUMN serial_pattern TEXT,
  ADD COLUMN serial_tracked BOOLEAN NOT NULL DEFAULT false, ADD COLUMN quantity_tracked BOOLEAN NOT NULL DEFAULT true;
-- 2') 시드(scripts/seed-device-registry.sql에도 동일 — onprem_device_type IS NULL 가드로 사용자 편집 보존)
UPDATE device_info SET onprem_device_type=1, serial_pattern='^A[0-9]{6}$', serial_tracked=true WHERE device_model='MC200M-T' AND onprem_device_type IS NULL;
UPDATE device_info SET onprem_device_type=3, serial_pattern='^P[0-9]{6}$', serial_tracked=true WHERE device_model='MP100W'   AND onprem_device_type IS NULL;
INSERT INTO device_info (device_model, device_name, device_class, onprem_device_type, serial_pattern, serial_tracked, quantity_tracked, is_active, sort_order, updated_at) VALUES
  ('MGW1010','게이트웨이','GATEWAY',NULL,'^B[0-9]{6}$',true,false,true,3,NOW()),
  ('SL-MPF1K07','링 혈압계(CART BP)','THIRD_PARTY',10,'^[FGK][-A-Za-z0-9]{6}-[-A-Za-z0-9]{5}$',true,false,true,10,NOW()),
  ('H2-ABPM','참 혈압계(Charm BP)','THIRD_PARTY',11,'^H2-BPM-[A-Z0-9]{4}$',true,false,true,11,NOW()),
  ('RTLS-TAG','RTLS 태그','THIRD_PARTY',8,NULL,true,false,true,12,NOW())
ON CONFLICT (device_model) DO NOTHING;

-- 3) D4: 병동
CREATE TABLE hospital_wards (
  id SERIAL PRIMARY KEY,
  hospital_code TEXT NOT NULL REFERENCES hospitals(hospital_code) ON DELETE RESTRICT ON UPDATE CASCADE,
  name TEXT NOT NULL, name_norm TEXT NOT NULL, ext_ward_code TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true, sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT hospital_wards_hospital_code_name_norm_key UNIQUE (hospital_code, name_norm),
  CONSTRAINT hospital_wards_id_hospital_code_key UNIQUE (id, hospital_code));
CREATE UNIQUE INDEX hospital_wards_hospital_code_ext_ward_code_key ON hospital_wards(hospital_code, ext_ward_code) WHERE ext_ward_code IS NOT NULL;

-- 4) D1/D3: 물리 개체(이름 승계)
CREATE TABLE hospital_devices (
  id SERIAL PRIMARY KEY,
  device_info_id INTEGER NOT NULL REFERENCES device_info(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  serial_no TEXT NOT NULL, serial_raw TEXT, mac_address TEXT, ext_device_code TEXT,
  inventory_unit_id INTEGER REFERENCES inventory_units(id) ON DELETE SET NULL,
  memo TEXT, ext_last_seen_at TIMESTAMP(3), ext_synced_at TIMESTAMP(3),
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  hospital_code TEXT REFERENCES hospitals(hospital_code) ON DELETE RESTRICT ON UPDATE CASCADE,
  ward_id INTEGER, placed_on DATE,
  last_hospital_code TEXT REFERENCES hospitals(hospital_code) ON DELETE SET NULL ON UPDATE CASCADE,
  recovered_on DATE, recover_reason_id INTEGER REFERENCES status_codes(id) ON DELETE RESTRICT,
  last_event_type TEXT, last_event_on DATE,
  replaced_by_id INTEGER REFERENCES hospital_devices(id) ON DELETE SET NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT hospital_devices_serial_no_key UNIQUE (serial_no),
  CONSTRAINT hospital_devices_inventory_unit_id_key UNIQUE (inventory_unit_id),
  CONSTRAINT hospital_devices_status_check CHECK (status IN ('ACTIVE','RECOVERED')),
  CONSTRAINT hospital_devices_active_hospital_check CHECK ((status='ACTIVE') = (hospital_code IS NOT NULL)),
  CONSTRAINT hospital_devices_ward_only_active_check CHECK (ward_id IS NULL OR status='ACTIVE'),
  CONSTRAINT hospital_devices_ward_fkey FOREIGN KEY (ward_id, hospital_code) REFERENCES hospital_wards(id, hospital_code)
    ON DELETE RESTRICT ON UPDATE CASCADE DEFERRABLE INITIALLY DEFERRED);
CREATE INDEX hospital_devices_hospital_code_status_idx     ON hospital_devices(hospital_code, status);
CREATE INDEX hospital_devices_hospital_model_status_idx    ON hospital_devices(hospital_code, device_info_id, status);
CREATE INDEX hospital_devices_device_info_id_status_idx    ON hospital_devices(device_info_id, status);
CREATE INDEX hospital_devices_ward_id_idx                  ON hospital_devices(ward_id);
CREATE INDEX hospital_devices_last_hospital_code_status_idx ON hospital_devices(last_hospital_code, status);
CREATE INDEX hospital_devices_serial_no_pattern_idx        ON hospital_devices(serial_no text_pattern_ops);

-- 5) D6: 임포트 배치
CREATE TABLE hospital_device_import_batches (
  id SERIAL PRIMARY KEY,
  hospital_code TEXT NOT NULL REFERENCES hospitals(hospital_code) ON DELETE RESTRICT ON UPDATE CASCADE,
  source_kind TEXT NOT NULL, mode TEXT NOT NULL DEFAULT 'REGISTER', file_name TEXT, occurred_on DATE NOT NULL, note TEXT,
  row_count INTEGER NOT NULL DEFAULT 0, registered_count INTEGER NOT NULL DEFAULT 0, reregistered_count INTEGER NOT NULL DEFAULT 0,
  skipped_count INTEGER NOT NULL DEFAULT 0, transferred_count INTEGER NOT NULL DEFAULT 0, summary JSONB,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL, created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  cancelled_at TIMESTAMP(3), cancelled_by TEXT REFERENCES users(id) ON DELETE SET NULL, cancel_summary JSONB,
  CONSTRAINT hospital_device_import_batches_source_kind_check CHECK (source_kind IN ('EXCEL','PASTE')));
CREATE INDEX hospital_device_import_batches_hospital_created_idx ON hospital_device_import_batches(hospital_code, created_at DESC);

-- 6) 이벤트(append-first)
CREATE TABLE hospital_device_events (
  id SERIAL PRIMARY KEY,
  device_id INTEGER NOT NULL REFERENCES hospital_devices(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  event_type TEXT NOT NULL,
  hospital_code TEXT REFERENCES hospitals(hospital_code) ON DELETE RESTRICT ON UPDATE CASCADE,
  from_ward_id INTEGER, to_ward_id INTEGER,
  reason_code_id INTEGER REFERENCES status_codes(id) ON DELETE RESTRICT,
  occurred_on DATE NOT NULL, memo TEXT, ref_type TEXT, ref_code TEXT,
  related_device_id INTEGER REFERENCES hospital_devices(id) ON DELETE SET NULL,
  action_group UUID, source TEXT NOT NULL DEFAULT 'MANUAL',
  import_batch_id INTEGER REFERENCES hospital_device_import_batches(id) ON DELETE RESTRICT,
  changes JSONB, actor_id TEXT REFERENCES users(id) ON DELETE SET NULL, actor_name TEXT,
  edited_at TIMESTAMP(3), edited_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT hospital_device_events_type_check CHECK (event_type IN ('REGISTER','MOVE_WARD','RECOVER','CORRECT')),
  CONSTRAINT hospital_device_events_hospital_check CHECK (event_type='CORRECT' OR hospital_code IS NOT NULL),
  CONSTRAINT hospital_device_events_ward_requires_hospital_check CHECK (hospital_code IS NOT NULL OR (from_ward_id IS NULL AND to_ward_id IS NULL)),
  CONSTRAINT hospital_device_events_reason_check CHECK (event_type<>'RECOVER' OR reason_code_id IS NOT NULL),
  CONSTRAINT hospital_device_events_changes_check CHECK (event_type<>'CORRECT' OR changes IS NOT NULL),
  CONSTRAINT hospital_device_events_ref_check CHECK ((ref_type IS NULL) = (ref_code IS NULL)),
  CONSTRAINT hospital_device_events_from_ward_fkey FOREIGN KEY (from_ward_id, hospital_code) REFERENCES hospital_wards(id, hospital_code) ON DELETE RESTRICT ON UPDATE CASCADE DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT hospital_device_events_to_ward_fkey   FOREIGN KEY (to_ward_id,   hospital_code) REFERENCES hospital_wards(id, hospital_code) ON DELETE RESTRICT ON UPDATE CASCADE DEFERRABLE INITIALLY DEFERRED);
CREATE INDEX hospital_device_events_device_idx       ON hospital_device_events(device_id, occurred_on, id);
CREATE INDEX hospital_device_events_hospital_idx     ON hospital_device_events(hospital_code, occurred_on DESC, id DESC);
CREATE INDEX hospital_device_events_ref_idx          ON hospital_device_events(ref_type, ref_code) WHERE ref_type IS NOT NULL;
CREATE INDEX hospital_device_events_import_batch_idx ON hospital_device_events(import_batch_id) WHERE import_batch_id IS NOT NULL;
CREATE INDEX hospital_device_events_action_group_idx ON hospital_device_events(action_group) WHERE action_group IS NOT NULL;
CREATE INDEX hospital_device_events_type_date_idx    ON hospital_device_events(event_type, occurred_on DESC);
CREATE UNIQUE INDEX hospital_device_events_auto_ref_idem_key ON hospital_device_events(ref_type, ref_code, device_id, event_type)
  WHERE ref_type IS NOT NULL AND source IN ('WMS','ONPREM');          -- 불변식 8 (MANUAL 제외)

-- 7) D5: 회수 사유 마스터
INSERT INTO status_codes (name, category, "order", value) VALUES
  ('불량(AS 회수)','DEVICE_RECOVERY_REASON',1,'DEFECT'), ('분실','DEVICE_RECOVERY_REASON',2,'LOST'),
  ('반납(계약 종료·축소)','DEVICE_RECOVERY_REASON',3,'RETURN'), ('데모 종료','DEVICE_RECOVERY_REASON',4,NULL),
  ('현장 폐기','DEVICE_RECOVERY_REASON',5,'DISPOSE'), ('타 병원 이관','DEVICE_RECOVERY_REASON',6,'TRANSFER'),
  ('기타','DEVICE_RECOVERY_REASON',9,NULL)
ON CONFLICT (name, category) DO NOTHING;

-- 8) nav (icon 'device'는 P3에서 ICON_MAP에 추가)
INSERT INTO nav_menu_items (menu_key, label, href, icon_key, parent_key, sort_order, allowed_org_codes) VALUES
  ('devices','디바이스 원장','/devices','device','operations',55,'{SEERS}') ON CONFLICT (menu_key) DO NOTHING;
INSERT INTO nav_menu_items (menu_key, label, href, parent_key, sort_order, group_label, allowed_roles) VALUES
  ('settings/device-recovery-reason','기기 회수 사유 관리','/settings/device-recovery-reason','settings',41,'병원·구축','{SUPER_ADMIN,ADMIN}') ON CONFLICT (menu_key) DO NOTHING;
