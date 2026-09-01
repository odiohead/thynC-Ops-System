-- 병원별 웨어러블 디바이스 원장 마스터 시드 (projects/hospital_device_registry_design.md 부록 A.2)
-- 마이그레이션 20260901120000_hospital_device_registry 적용 후 재실행 안전 — DDL 없음
-- idempotent: PROD 최초 반영·데이터 동기화 후 재실행 가능 (seed-cs-masters.sql 선례 형식)
--   psql -U thync -d thync_ops_dev -f scripts/seed-device-registry.sql
-- 주의: WMS(inventory_*) 테이블 문장 없음 (D9 — WMS 쓰기 금지)

-- 1) device_info — 기존 2행 플래그 (onprem_device_type IS NULL 가드로 사용자 편집 보존)
UPDATE device_info SET onprem_device_type=1, serial_pattern='^A[0-9]{6}$', serial_tracked=true WHERE device_model='MC200M-T' AND onprem_device_type IS NULL;
UPDATE device_info SET onprem_device_type=3, serial_pattern='^P[0-9]{6}$', serial_tracked=true WHERE device_model='MP100W'   AND onprem_device_type IS NULL;

-- 2) device_info — 게이트웨이·제3자 4행 (D2: 시리얼 추적 O / 수량 폼 노출 X)
INSERT INTO device_info (device_model, device_name, device_class, onprem_device_type, serial_pattern, serial_tracked, quantity_tracked, is_active, sort_order, updated_at) VALUES
  ('MGW1010','게이트웨이','GATEWAY',NULL,'^B[0-9]{6}$',true,false,true,3,NOW()),
  ('SL-MPF1K07','링 혈압계(CART BP)','THIRD_PARTY',10,'^[FGK][-A-Za-z0-9]{6}-[-A-Za-z0-9]{5}$',true,false,true,10,NOW()),
  ('H2-ABPM','참 혈압계(Charm BP)','THIRD_PARTY',11,'^H2-BPM-[A-Z0-9]{4}$',true,false,true,11,NOW()),
  ('RTLS-TAG','RTLS 태그','THIRD_PARTY',8,NULL,true,false,true,12,NOW())
ON CONFLICT (device_model) DO NOTHING;

-- 3) 회수 사유 마스터 (DEVICE_RECOVERY_REASON — D5: 시스템 의미는 value, 라벨은 설정에서 편집)
INSERT INTO status_codes (name, category, "order", value) VALUES
  ('불량(AS 회수)','DEVICE_RECOVERY_REASON',1,'DEFECT'), ('분실','DEVICE_RECOVERY_REASON',2,'LOST'),
  ('반납(계약 종료·축소)','DEVICE_RECOVERY_REASON',3,'RETURN'), ('데모 종료','DEVICE_RECOVERY_REASON',4,NULL),
  ('현장 폐기','DEVICE_RECOVERY_REASON',5,'DISPOSE'), ('타 병원 이관','DEVICE_RECOVERY_REASON',6,'TRANSFER'),
  ('기타','DEVICE_RECOVERY_REASON',9,NULL)
ON CONFLICT (name, category) DO NOTHING;

-- 3') 용도 마스터 (DEVICE_USAGE_TYPE — 2026-09-01 결정: 판매용/평가용 2값, value가 시스템 의미. 대웅제약재고는 판매용 창고이지 제3의 값이 아님)
INSERT INTO status_codes (name, category, "order", value) VALUES
  ('판매용','DEVICE_USAGE_TYPE',1,'SALE'), ('평가용','DEVICE_USAGE_TYPE',2,'EVAL')
ON CONFLICT (name, category) DO NOTHING;

-- 4) nav (icon 'device'는 P3에서 ICON_MAP에 추가 / 원장 nav는 SEERS 게이트 — D10)
INSERT INTO nav_menu_items (menu_key, label, href, icon_key, parent_key, sort_order, allowed_org_codes) VALUES
  ('devices','디바이스 원장','/devices','device','operations',55,'{SEERS}') ON CONFLICT (menu_key) DO NOTHING;
INSERT INTO nav_menu_items (menu_key, label, href, parent_key, sort_order, group_label, allowed_roles) VALUES
  ('settings/device-recovery-reason','기기 회수 사유 관리','/settings/device-recovery-reason','settings',41,'병원·구축','{SUPER_ADMIN,ADMIN}') ON CONFLICT (menu_key) DO NOTHING;
INSERT INTO nav_menu_items (menu_key, label, href, parent_key, sort_order, group_label, allowed_roles) VALUES
  ('settings/device-usage-type','기기 용도 관리','/settings/device-usage-type','settings',42,'병원·구축','{SUPER_ADMIN,ADMIN}') ON CONFLICT (menu_key) DO NOTHING;

-- 확인
SELECT device_model, device_class, onprem_device_type, serial_tracked, quantity_tracked FROM device_info ORDER BY sort_order;
SELECT name, "order", value FROM status_codes WHERE category = 'DEVICE_RECOVERY_REASON' ORDER BY "order";
SELECT name, "order", value FROM status_codes WHERE category = 'DEVICE_USAGE_TYPE' ORDER BY "order";
SELECT menu_key, parent_key, sort_order FROM nav_menu_items WHERE menu_key IN ('devices', 'settings/device-recovery-reason', 'settings/device-usage-type');
