-- 출고요청 시스템 구성품 — 대웅제약재고 복제 + 구성품 종류 등록 (2026-11-12, 멱등)
--   psql -U thync -d thync_ops_dev -f scripts/seed-stock-out-component-kinds.sql
-- 전제: 마이그 20261112150000_stock_out_component_kinds 적용.
-- 하는 일 (현재 '구성' 설정 stock_out_item_components 기준 — 특정 품목명을 고정하지 않는다):
--   1) 구성품으로 쓰이는 품목 중 대웅제약재고 소속이 아닌 것(= thynC운영팀재고 원본)을 **대웅제약재고에 품목 정보 그대로 복제**(새 품목코드, 재고 0)
--   2) stock_out_component_kinds 에 (복제 품목, 원본 품목) 등록 — 원본은 출고 처리에서 미출고분이 편입되는 품목
--   3) 구성 설정의 구성품을 복제 품목으로 교체
--   4) 시스템 × 구성품 종류 행을 전부 채움(없던 조합은 수량 0) — 설정 화면은 수량만 수정
-- 다시 실행해도 이미 등록된 원본은 건너뛴다. 재고·시리얼 개체는 옮기지 않는다(대웅제약재고 입고는 운영에서).
DO $$
DECLARE
  dw_id INT;
  r RECORD;
  new_id INT;
  seq INT;
  ord INT;
BEGIN
  SELECT id INTO dw_id FROM inventories WHERE name = '대웅제약재고';
  IF dw_id IS NULL THEN RAISE EXCEPTION '인벤토리 ''대웅제약재고''가 없습니다.'; END IF;
  SELECT coalesce(max(sort_order), 0) INTO ord FROM stock_out_component_kinds;

  FOR r IN
    SELECT ch.*, x.first_ord
      FROM (SELECT child_item_id, min(sort_order) AS first_ord FROM stock_out_item_components GROUP BY child_item_id) x
      JOIN inventory_items ch ON ch.id = x.child_item_id
     WHERE ch.inventory_id <> dw_id
       AND NOT EXISTS (SELECT 1 FROM stock_out_component_kinds k WHERE k.source_item_id = ch.id)
     ORDER BY x.first_ord, ch.id
  LOOP
    SELECT coalesce(max(substring(item_code FROM 6)::INT), 0) + 1 INTO seq FROM inventory_items WHERE item_code ~ '^ITEM-[0-9]+$';
    INSERT INTO inventory_items (
      item_code, name, category_id, spec, unit, is_serial_managed, is_lot_managed, device_info_id, ref_price, memo, is_active, sort_order,
      manufacturer_id, model_name, inventory_id, tags, udi_di, ledger_name, product_class, material_no, pack_unit, created_at, updated_at
    ) VALUES (
      'ITEM-' || lpad(seq::TEXT, 4, '0'), r.name, r.category_id, r.spec, r.unit, r.is_serial_managed, r.is_lot_managed, r.device_info_id, r.ref_price, r.memo, r.is_active, r.sort_order,
      r.manufacturer_id, r.model_name, dw_id, r.tags, r.udi_di, r.ledger_name, r.product_class, r.material_no, r.pack_unit, now(), now()
    ) RETURNING id INTO new_id;
    ord := ord + 10;
    INSERT INTO stock_out_component_kinds (item_id, source_item_id, sort_order) VALUES (new_id, r.id, ord);
    UPDATE stock_out_item_components SET child_item_id = new_id WHERE child_item_id = r.id;
    RAISE NOTICE '복제: % (원본 #% → 대웅제약재고 #%)', r.name, r.id, new_id;
  END LOOP;

  -- 시스템 × 구성품 종류 전 조합 (없던 조합은 수량 0) + 표시 순서를 종류 순서로 통일
  INSERT INTO stock_out_item_components (parent_item_id, child_item_id, quantity, sort_order)
  SELECT p.parent_item_id, k.item_id, 0, k.sort_order
    FROM (SELECT DISTINCT parent_item_id FROM stock_out_item_components) p CROSS JOIN stock_out_component_kinds k
  ON CONFLICT (parent_item_id, child_item_id) DO NOTHING;
  UPDATE stock_out_item_components c SET sort_order = k.sort_order FROM stock_out_component_kinds k WHERE k.item_id = c.child_item_id AND c.sort_order <> k.sort_order;
END $$;

-- 결과 확인
SELECT k.sort_order, i.item_code, i.name, inv.name AS inventory, s.item_code AS source_code, sinv.name AS source_inventory, i.is_serial_managed
  FROM stock_out_component_kinds k JOIN inventory_items i ON i.id = k.item_id JOIN inventories inv ON inv.id = i.inventory_id
  JOIN inventory_items s ON s.id = k.source_item_id JOIN inventories sinv ON sinv.id = s.inventory_id ORDER BY k.sort_order;
