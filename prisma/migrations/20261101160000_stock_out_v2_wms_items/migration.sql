-- 출고업무 v2 (projects/stock_out_v2_design.md §4·§9) — 품목 소스를 자재관리 품목(inventory_items)으로 전환
-- 1) 업무별 노출 설정 (행 존재 = 체크)
CREATE TABLE IF NOT EXISTS stock_out_item_purposes (
  inventory_item_id INTEGER NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
  purpose           VARCHAR(16) NOT NULL,                 -- BUILD 구축 / MAINTENANCE 유지보수 / BUSINESS 사업업무 (lib/stockOutShared.ts)
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (inventory_item_id, purpose),
  CONSTRAINT stock_out_item_purposes_purpose_check CHECK (purpose IN ('BUILD','MAINTENANCE','BUSINESS'))
);
CREATE INDEX IF NOT EXISTS stock_out_item_purposes_purpose_idx ON stock_out_item_purposes (purpose);

-- 2) 출고요청 업무 구분 (이번 범위: 프로젝트 팝업 = BUILD)
ALTER TABLE stock_out_requests ADD COLUMN IF NOT EXISTS purpose VARCHAR(16) NOT NULL DEFAULT 'BUILD';
ALTER TABLE stock_out_requests DROP CONSTRAINT IF EXISTS stock_out_requests_purpose_check;
ALTER TABLE stock_out_requests ADD CONSTRAINT stock_out_requests_purpose_check CHECK (purpose IN ('BUILD','MAINTENANCE','BUSINESS'));

-- 3) 요청 라인 item_id(stock_out_items) → inventory_item_id(inventory_items). 백필: 대웅제약재고의 같은 model_name
ALTER TABLE stock_out_request_items ADD COLUMN IF NOT EXISTS inventory_item_id INTEGER;
UPDATE stock_out_request_items l
   SET inventory_item_id = ii.id
  FROM stock_out_items s
  JOIN inventories inv ON inv.name = '대웅제약재고'
  JOIN inventory_items ii ON ii.inventory_id = inv.id AND ii.model_name = s.wms_model_name
 WHERE l.item_id = s.id AND l.inventory_item_id IS NULL;
DO $$
DECLARE n INT;
BEGIN
  SELECT count(*) INTO n FROM stock_out_request_items WHERE inventory_item_id IS NULL;
  IF n > 0 THEN RAISE EXCEPTION '출고요청 라인 %건의 자재관리 품목 매핑 실패 — 수동 확인 필요', n; END IF;
END $$;
ALTER TABLE stock_out_request_items ALTER COLUMN inventory_item_id SET NOT NULL;
ALTER TABLE stock_out_request_items DROP CONSTRAINT IF EXISTS stock_out_request_items_inventory_item_id_fkey;
ALTER TABLE stock_out_request_items ADD CONSTRAINT stock_out_request_items_inventory_item_id_fkey
  FOREIGN KEY (inventory_item_id) REFERENCES inventory_items(id);
ALTER TABLE stock_out_request_items DROP CONSTRAINT IF EXISTS stock_out_request_items_request_item_key;
DROP INDEX IF EXISTS stock_out_request_items_item_id_idx;
CREATE UNIQUE INDEX IF NOT EXISTS stock_out_request_items_request_inventory_item_key ON stock_out_request_items (request_id, inventory_item_id);
CREATE INDEX IF NOT EXISTS stock_out_request_items_inventory_item_id_idx ON stock_out_request_items (inventory_item_id);
ALTER TABLE stock_out_request_items DROP COLUMN IF EXISTS item_id;

-- 4) 전용 품목 마스터 폐기 (결정 3)
DROP TABLE IF EXISTS stock_out_items;
