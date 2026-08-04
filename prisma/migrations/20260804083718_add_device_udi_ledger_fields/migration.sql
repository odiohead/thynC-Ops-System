-- UDI 입출고대장 (projects/inventory_udi_ledger_design.md) P1
-- device_info를 모델 마스터로 승격 — UDI-DI·대장 표기 정보 부여

ALTER TABLE device_info
  ADD COLUMN IF NOT EXISTS udi_di        VARCHAR(50),
  ADD COLUMN IF NOT EXISTS ledger_name   VARCHAR(100),
  ADD COLUMN IF NOT EXISTS product_class VARCHAR(20),
  ADD COLUMN IF NOT EXISTS material_no   VARCHAR(50),
  ADD COLUMN IF NOT EXISTS pack_unit     VARCHAR(20) NOT NULL DEFAULT 'EA',
  ADD COLUMN IF NOT EXISTS is_udi_target BOOLEAN NOT NULL DEFAULT false;

-- UDI-DI는 값이 있는 것끼리만 중복 불가 (미등록 NULL 다수 허용)
CREATE UNIQUE INDEX IF NOT EXISTS device_info_udi_di_key
  ON device_info (udi_di) WHERE udi_di IS NOT NULL;

-- UDI 대상 모델 6종 (2026-08-04 사용자 확정)
-- 신규 행은 is_active=false — 병원 장비 배정 셀렉터가 isActive 필터 없이 전량 조회하므로 기존 화면 오염 방지
INSERT INTO device_info (device_model, device_name, is_active, sort_order, is_udi_target, created_at, updated_at)
VALUES
  ('MP1000F', '산소포화도센서', false, 100, true, NOW(), NOW()),
  ('MP2000F', '산소포화도센서', false, 101, true, NOW(), NOW()),
  ('MP2000R', '산소포화도센서', false, 102, true, NOW(), NOW()),
  ('MGW1010', '게이트웨이',     false, 103, true, NOW(), NOW())
ON CONFLICT (device_model) DO NOTHING;

-- 기존 2종도 UDI 대상으로 표시
UPDATE device_info SET is_udi_target = true WHERE device_model IN ('MC200M-T', 'MP100W');

-- 대장 표기명·품명 구분: 원본 양식(F707-1, MP100W(MP6414).docx)에 명시된 값만 시드.
-- 나머지 모델의 표기명·품명 구분·원자재식별 NO는 설정 화면에서 입력.
UPDATE device_info
   SET ledger_name = 'MP100W Series', product_class = '완제품'
 WHERE device_model = 'MP100W' AND ledger_name IS NULL;

-- 품목 → 모델 연결 백필 (모델명 일치 기준)
UPDATE inventory_items i
   SET device_info_id = d.id
  FROM device_info d
 WHERE d.device_model = i.model_name
   AND i.device_info_id IS NULL;
