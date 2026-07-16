-- 자재관리 재설계: 인벤토리별 완전 독립 관리
-- ① 품목(inventory_items)·위치(warehouses)를 인벤토리에 귀속 (같은 물건도 인벤토리마다 별도 품목·별도 코드)
-- ② 기존 데이터 분리 백필: 품목은 사용된 인벤토리마다 복제(새 코드 발번), 활성 위치는 전 인벤토리에 복제 후 참조 재매핑
-- ③ 이관(TRANSFER) 기능 제거 — inventories.is_transfer_locked 삭제. 기존 TRANSFER 전표는 이력 표시용으로만 보존(신규 생성·취소 불가)
--    to_inventory_id/transfer_date/transfer_price 컬럼은 과거 이관 전표 표시를 위해 유지 (deprecated)

-- ─── 1. 컬럼 추가 ───
ALTER TABLE inventory_items ADD COLUMN inventory_id INTEGER REFERENCES inventories(id);
ALTER TABLE warehouses ADD COLUMN inventory_id INTEGER REFERENCES inventories(id);

-- ─── 2. 수량 0 재고 스냅샷 정리 (upsert로 재생성되는 캐시 행 — 유령 품목 복제 방지) ───
DELETE FROM inventory_stocks WHERE quantity = 0;

-- ─── 3. 품목 분리 백필 ───
-- 각 품목의 '주 인벤토리' = 재고 합이 가장 큰 인벤토리 (동률 시 낮은 id, 사용 이력 없으면 최소 인벤토리 id).
-- 그 외 사용된 인벤토리마다 품목 행을 복제(새 ITEM-NNNN 발번)하고 재고·개체·전표를 복제 품목으로 재매핑.
DO $$
DECLARE
  itm RECORD;
  usage_inv RECORD;
  primary_inv INTEGER;
  new_item_id INTEGER;
  seq INTEGER;
BEGIN
  SELECT COALESCE(MAX(substring(item_code from 6)::int), 0) INTO seq
  FROM inventory_items WHERE item_code ~ '^ITEM-[0-9]+$';

  FOR itm IN SELECT * FROM inventory_items WHERE inventory_id IS NULL ORDER BY id LOOP
    -- 주 인벤토리 결정
    SELECT s.inventory_id INTO primary_inv
    FROM inventory_stocks s WHERE s.item_id = itm.id
    GROUP BY s.inventory_id
    ORDER BY SUM(s.quantity) DESC, s.inventory_id ASC
    LIMIT 1;

    IF primary_inv IS NULL THEN
      SELECT MIN(x.inv) INTO primary_inv FROM (
        SELECT inventory_id AS inv FROM inventory_units WHERE item_id = itm.id
        UNION SELECT inventory_id FROM inventory_transactions WHERE item_id = itm.id
      ) x;
    END IF;
    IF primary_inv IS NULL THEN
      SELECT MIN(id) INTO primary_inv FROM inventories;
    END IF;

    UPDATE inventory_items SET inventory_id = primary_inv WHERE id = itm.id;

    -- 주 인벤토리 외 사용 인벤토리 → 품목 복제 + 참조 재매핑
    FOR usage_inv IN
      SELECT DISTINCT q.inv FROM (
        SELECT inventory_id AS inv FROM inventory_stocks WHERE item_id = itm.id
        UNION SELECT inventory_id FROM inventory_units WHERE item_id = itm.id
        UNION SELECT inventory_id FROM inventory_transactions WHERE item_id = itm.id
        UNION SELECT to_inventory_id FROM inventory_transactions
          WHERE item_id = itm.id AND to_inventory_id IS NOT NULL AND canceled_at IS NULL
      ) q WHERE q.inv <> primary_inv
      ORDER BY q.inv
    LOOP
      seq := seq + 1;
      INSERT INTO inventory_items
        (item_code, name, model_name, category_id, spec, unit, is_serial_managed,
         device_info_id, manufacturer_id, ref_price, memo, is_active, sort_order,
         inventory_id, created_at, updated_at)
      VALUES
        ('ITEM-' || lpad(seq::text, 4, '0'), itm.name, itm.model_name, itm.category_id, itm.spec, itm.unit, itm.is_serial_managed,
         itm.device_info_id, itm.manufacturer_id, itm.ref_price, itm.memo, itm.is_active, itm.sort_order,
         usage_inv.inv, now(), now())
      RETURNING id INTO new_item_id;

      UPDATE inventory_stocks SET item_id = new_item_id WHERE item_id = itm.id AND inventory_id = usage_inv.inv;
      UPDATE inventory_units  SET item_id = new_item_id WHERE item_id = itm.id AND inventory_id = usage_inv.inv;
      UPDATE inventory_transactions SET item_id = new_item_id WHERE item_id = itm.id AND inventory_id = usage_inv.inv;
    END LOOP;
  END LOOP;
END $$;

ALTER TABLE inventory_items ALTER COLUMN inventory_id SET NOT NULL;
CREATE INDEX inventory_items_inventory_id_idx ON inventory_items(inventory_id);

-- 주자재-부자재 매핑은 같은 인벤토리 안에서만 유효 — 인벤토리가 갈라진 매핑 제거
DELETE FROM inventory_item_components c
USING inventory_items p, inventory_items ch
WHERE c.parent_item_id = p.id AND c.child_item_id = ch.id
  AND p.inventory_id <> ch.inventory_id;

-- ─── 4. 위치(창고) 분리 백필 ───
-- 활성 위치는 모든 인벤토리에 복제(각자 독립 관리 시작점), 비활성 위치는 실제 사용된 인벤토리에만.
-- 원본 행은 첫 대상 인벤토리에 귀속, 나머지는 복제 후 해당 인벤토리의 재고·개체·전표 참조를 복제본으로 재매핑.
DROP INDEX warehouses_name_key; -- 전역 위치명 UNIQUE 해제 (복제 전 필수) → 인벤토리 내 UNIQUE로 대체
DO $$
DECLARE
  wh RECORD;
  target_inv RECORD;
  assigned BOOLEAN;
  new_wh_id INTEGER;
BEGIN
  FOR wh IN SELECT * FROM warehouses WHERE inventory_id IS NULL ORDER BY id LOOP
    assigned := false;
    FOR target_inv IN
      SELECT i.id FROM inventories i
      WHERE wh.is_active
         OR EXISTS (SELECT 1 FROM inventory_stocks s WHERE s.warehouse_id = wh.id AND s.inventory_id = i.id)
         OR EXISTS (SELECT 1 FROM inventory_units u WHERE u.warehouse_id = wh.id AND u.inventory_id = i.id)
         OR EXISTS (SELECT 1 FROM inventory_transactions t
                    WHERE (t.warehouse_id = wh.id AND t.inventory_id = i.id)
                       OR (t.to_warehouse_id = wh.id AND COALESCE(t.to_inventory_id, t.inventory_id) = i.id))
      ORDER BY i.id
    LOOP
      IF NOT assigned THEN
        UPDATE warehouses SET inventory_id = target_inv.id WHERE id = wh.id;
        assigned := true;
      ELSE
        INSERT INTO warehouses (name, memo, is_active, sort_order, inventory_id, created_at)
        VALUES (wh.name, wh.memo, wh.is_active, wh.sort_order, target_inv.id, now())
        RETURNING id INTO new_wh_id;

        UPDATE inventory_stocks SET warehouse_id = new_wh_id WHERE warehouse_id = wh.id AND inventory_id = target_inv.id;
        UPDATE inventory_units  SET warehouse_id = new_wh_id WHERE warehouse_id = wh.id AND inventory_id = target_inv.id;
        UPDATE inventory_transactions SET warehouse_id = new_wh_id
          WHERE warehouse_id = wh.id AND inventory_id = target_inv.id;
        UPDATE inventory_transactions SET to_warehouse_id = new_wh_id
          WHERE to_warehouse_id = wh.id AND COALESCE(to_inventory_id, inventory_id) = target_inv.id;
      END IF;
    END LOOP;
    IF NOT assigned THEN
      UPDATE warehouses SET inventory_id = (SELECT MIN(id) FROM inventories) WHERE id = wh.id;
    END IF;
  END LOOP;
END $$;

ALTER TABLE warehouses ALTER COLUMN inventory_id SET NOT NULL;
CREATE UNIQUE INDEX warehouses_inventory_id_name_key ON warehouses(inventory_id, name);

-- ─── 5. 이관 잠금 플래그 제거 (이관 기능 폐지) ───
ALTER TABLE inventories DROP COLUMN is_transfer_locked;
