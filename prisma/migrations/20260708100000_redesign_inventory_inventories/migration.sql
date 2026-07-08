-- 자재관리 재설계 (function_wms.md Phase 9)
-- 소유×용도 2차원 → 인벤토리 1차원(대웅제약재고/평가용재고/판매용재고),
-- 주자재-부자재 매핑, 입출고 유형 마스터화, 출고처(destination), 세트출고(parent_tx_id),
-- 안전재고 기능 제거

-- 1. 인벤토리 마스터
CREATE TABLE inventories (
  id                 SERIAL PRIMARY KEY,
  name               VARCHAR(50) UNIQUE NOT NULL,
  is_transfer_locked BOOLEAN NOT NULL DEFAULT false,  -- true면 이관(TRANSFER) 출발·도착 불가 (평가용재고)
  memo               TEXT,
  is_active          BOOLEAN NOT NULL DEFAULT true,
  sort_order         INT NOT NULL DEFAULT 0,
  created_at         TIMESTAMP NOT NULL DEFAULT now()
);

INSERT INTO inventories (name, is_transfer_locked, sort_order) VALUES
  ('대웅제약재고', false, 0),
  ('평가용재고',   true,  1),
  ('판매용재고',   false, 2);

-- 2. 주자재-부자재 매핑 (1단계 깊이 — 검증은 API)
CREATE TABLE inventory_item_components (
  parent_item_id INT NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
  child_item_id  INT NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
  quantity       INT NOT NULL DEFAULT 1 CHECK (quantity > 0),  -- 주자재 1개당 부자재 구성 수량
  sort_order     INT NOT NULL DEFAULT 0,
  created_at     TIMESTAMP NOT NULL DEFAULT now(),
  PRIMARY KEY (parent_item_id, child_item_id),
  CHECK (parent_item_id <> child_item_id)
);
CREATE INDEX idx_inv_components_child ON inventory_item_components (child_item_id);

-- 3. inventory_id 컬럼 추가 + 기존 데이터 '판매용재고' 백필 (사용자 확정)
ALTER TABLE inventory_stocks       ADD COLUMN inventory_id INT REFERENCES inventories(id);
ALTER TABLE inventory_transactions ADD COLUMN inventory_id INT REFERENCES inventories(id);
ALTER TABLE inventory_units        ADD COLUMN inventory_id INT REFERENCES inventories(id);

UPDATE inventory_stocks       SET inventory_id = (SELECT id FROM inventories WHERE name = '판매용재고');
UPDATE inventory_transactions SET inventory_id = (SELECT id FROM inventories WHERE name = '판매용재고');
UPDATE inventory_units        SET inventory_id = (SELECT id FROM inventories WHERE name = '판매용재고');

ALTER TABLE inventory_stocks       ALTER COLUMN inventory_id SET NOT NULL;
ALTER TABLE inventory_transactions ALTER COLUMN inventory_id SET NOT NULL;
ALTER TABLE inventory_units        ALTER COLUMN inventory_id SET NOT NULL;

-- 4. 소유·용도 컬럼 제거 + stocks PK 3컬럼 재구성 (중복 버킷은 수량 합산 병합)
ALTER TABLE inventory_stocks DROP CONSTRAINT inventory_stocks_pkey;
ALTER TABLE inventory_stocks DROP COLUMN owner_id, DROP COLUMN purpose_id;

CREATE TEMP TABLE tmp_stock_merge AS
  SELECT item_id, warehouse_id, inventory_id, SUM(quantity)::int AS quantity, MAX(updated_at) AS updated_at
  FROM inventory_stocks GROUP BY 1, 2, 3;
DELETE FROM inventory_stocks;
INSERT INTO inventory_stocks (item_id, warehouse_id, inventory_id, quantity, updated_at)
  SELECT item_id, warehouse_id, inventory_id, quantity, updated_at FROM tmp_stock_merge;
DROP TABLE tmp_stock_merge;

ALTER TABLE inventory_stocks ADD CONSTRAINT inventory_stocks_pkey PRIMARY KEY (item_id, warehouse_id, inventory_id);

ALTER TABLE inventory_transactions DROP COLUMN owner_id, DROP COLUMN purpose_id;
ALTER TABLE inventory_units        DROP COLUMN owner_id, DROP COLUMN purpose_id;

-- 5. 전표 확장 — 이관 도착 인벤토리·출고처·세트출고 부모 전표
ALTER TABLE inventory_transactions ADD COLUMN to_inventory_id INT REFERENCES inventories(id);   -- TRANSFER 전용
ALTER TABLE inventory_transactions ADD COLUMN destination VARCHAR(100);                          -- OUT 출고처 (자유 텍스트)
ALTER TABLE inventory_transactions ADD COLUMN parent_tx_id INT REFERENCES inventory_transactions(id); -- 세트출고 자식 전표 → 부모
CREATE INDEX idx_inv_tx_inventory ON inventory_transactions (inventory_id, created_at DESC);
CREATE INDEX idx_inv_tx_parent ON inventory_transactions (parent_tx_id);
CREATE INDEX idx_inv_units_inventory ON inventory_units (inventory_id);

-- 6. 입고/출고 유형 마스터 (StatusCode) — value 있는 행은 시스템 유형(로직 결합, 삭제 보호)
INSERT INTO status_codes (name, category, value, "order") VALUES
  ('구매',       'STOCK_IN_TYPE',  NULL,      0),
  ('회수(반품)', 'STOCK_IN_TYPE',  'RETURN',  1),
  ('기타',       'STOCK_IN_TYPE',  NULL,      2),
  ('설치',       'STOCK_OUT_TYPE', NULL,      0),
  ('판매',       'STOCK_OUT_TYPE', NULL,      1),
  ('폐기',       'STOCK_OUT_TYPE', 'DISPOSE', 2),
  ('불량',       'STOCK_OUT_TYPE', 'DISPOSE', 3),
  ('기타',       'STOCK_OUT_TYPE', NULL,      4);

-- reason 문자열 → reason_id FK 전환 (미매칭은 '기타', MOVE는 NULL)
ALTER TABLE inventory_transactions ADD COLUMN reason_id INT REFERENCES status_codes(id);
UPDATE inventory_transactions t SET reason_id = sc.id
  FROM status_codes sc
  WHERE sc.category = CASE t.tx_type WHEN 'IN' THEN 'STOCK_IN_TYPE' WHEN 'OUT' THEN 'STOCK_OUT_TYPE' END
    AND sc.name = t.reason;
UPDATE inventory_transactions SET reason_id = (SELECT id FROM status_codes WHERE category = 'STOCK_IN_TYPE'  AND name = '기타')
  WHERE tx_type = 'IN'  AND reason_id IS NULL;
UPDATE inventory_transactions SET reason_id = (SELECT id FROM status_codes WHERE category = 'STOCK_OUT_TYPE' AND name = '기타')
  WHERE tx_type = 'OUT' AND reason_id IS NULL;
ALTER TABLE inventory_transactions DROP COLUMN reason;

-- 7. 소유·용도 StatusCode 제거
DELETE FROM status_codes WHERE category IN ('STOCK_OWNER', 'STOCK_PURPOSE');

-- 8. 안전재고 기능 제거
ALTER TABLE inventory_items DROP COLUMN safety_stock;
DELETE FROM app_settings WHERE key = 'notify_stock_enabled';
DELETE FROM notification_logs WHERE event_type = 'stock_low';

-- 9. 네비 메뉴 — 재고 구분 관리 → 인벤토리 관리, 입출고 유형 관리 추가
UPDATE nav_menu_items
  SET menu_key = 'settings/inventories', label = '인벤토리 관리', href = '/settings/inventories'
  WHERE menu_key = 'settings/stock-types';
INSERT INTO nav_menu_items (menu_key, label, href, parent_key, allowed_roles, sort_order, updated_at)
  VALUES ('settings/stock-reasons', '입출고 유형 관리', '/settings/stock-reasons', 'settings', '{SUPER_ADMIN,ADMIN}', 165, now());
