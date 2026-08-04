-- UDI 입출고대장 (projects/inventory_udi_ledger_design.md) — 설계 정정 (2026-08-04)
--
-- UDI를 모델(device_info)이 아니라 **품목(inventory_items)** 에 둔다.
-- 근거: 같은 모델이라도 사양·포장 변경으로 UDI-DI가 바뀔 수 있고, 그때는 신규 품목으로 분리해 관리한다.
-- 재고 버킷 PK가 이미 (item_id, warehouse_id, inventory_id, lot_no)이므로
-- UDI를 품목에 두면 재고 차원이 곧 UDI × LOT이 되어 재고 로직을 전혀 건드리지 않는다.
-- (모델에 두면 재고 PK에 udi 차원을 추가해야 해 입출고 전 경로 수정이 필요했다)
--
-- 인벤토리별로 품목이 분리되어 있으므로 같은 UDI가 복수 품목에 중복 존재한다 → UNIQUE 아님(일반 인덱스).

-- ── 1) 품목에 UDI·대장 정보 부여 ──
ALTER TABLE inventory_items
  ADD COLUMN IF NOT EXISTS udi_di        VARCHAR(50),
  ADD COLUMN IF NOT EXISTS ledger_name   VARCHAR(100),
  ADD COLUMN IF NOT EXISTS product_class VARCHAR(20),
  ADD COLUMN IF NOT EXISTS material_no   VARCHAR(50),
  ADD COLUMN IF NOT EXISTS pack_unit     VARCHAR(20) NOT NULL DEFAULT 'EA';

CREATE INDEX IF NOT EXISTS inventory_items_udi_di_idx
  ON inventory_items (udi_di) WHERE udi_di IS NOT NULL;

-- ── 2) UDI-DI 값 반영 (2026-08-04 사용자 제공, 인벤토리별 품목 전부에 동일 적용) ──
-- 전부 GS1 프리픽스 8800096, 체크디지트 검증 완료. MP1000F만 13자리(선행 0 없음)로 제공된 값 그대로 보존.
UPDATE inventory_items SET udi_di = '08800096401314' WHERE model_name = 'MC200M-T' AND udi_di IS NULL;
UPDATE inventory_items SET udi_di = '08800096401536' WHERE model_name = 'MP100W'   AND udi_di IS NULL;
UPDATE inventory_items SET udi_di = '08800096401642' WHERE model_name = 'MP2000F'  AND udi_di IS NULL;
UPDATE inventory_items SET udi_di = '08800096401680' WHERE model_name = 'MP2000R'  AND udi_di IS NULL;
UPDATE inventory_items SET udi_di = '8800096400508'  WHERE model_name = 'MP1000F'  AND udi_di IS NULL;
-- MGW1010(게이트웨이)은 UDI 미제공 → 미등록 상태 유지

-- ── 3) 대장 표기 정보 — 원본 양식(F707-1, MP100W(MP6414).docx)에 명시된 값만 시드 ──
UPDATE inventory_items
   SET ledger_name = 'MP100W Series', product_class = '완제품'
 WHERE model_name = 'MP100W' AND ledger_name IS NULL;

-- ── 4) device_info 원복 — UDI는 모델 소관이 아니므로 P1에서 추가한 것을 되돌린다 ──
-- UDI 목적으로만 추가했던 모델 4행 제거 (품목의 device_info_id는 FK SetNull로 자동 해제)
DELETE FROM device_info WHERE device_model IN ('MP1000F', 'MP2000F', 'MP2000R', 'MGW1010');

DROP INDEX IF EXISTS device_info_udi_di_key;

ALTER TABLE device_info
  DROP COLUMN IF EXISTS udi_di,
  DROP COLUMN IF EXISTS ledger_name,
  DROP COLUMN IF EXISTS product_class,
  DROP COLUMN IF EXISTS material_no,
  DROP COLUMN IF EXISTS pack_unit,
  DROP COLUMN IF EXISTS is_udi_target;
