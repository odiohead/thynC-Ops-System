-- 시스템 품목 수량 관리 전환 + 서버 품목 병상별 분리 — 1회성 데이터 이관 (projects/system_server_split_design.md §5)
--   psql -v ON_ERROR_STOP=1 -v finish=ROLLBACK -f scripts/migrate-system-units-to-servers.sql   # dry-run
--   psql -v ON_ERROR_STOP=1 -v finish=COMMIT   -f scripts/migrate-system-units-to-servers.sql   # 적용
-- 전제: 마이그 20261117100000_stock_out_kind_source_non_unique 적용. 한 번 적용되면 전제 검사에서 멈춘다(재실행 불가).
-- 하는 일
--   1) 대웅제약재고 ITEM-0076 서버(워크스테이션) → 서버(10병상) 개명, 서버(20·30·40병상) 신규
--   2) 구성품 종류 등록(편입 대상 = thynC운영팀재고 서버(워크스테이션))·표시 순서(서버 병상순 먼저)·시스템 × 서버 구성 설정
--   3) thynC시스템 6종의 시리얼 개체를 같은 병상 서버 품목으로 이관 — 서버 품목에 입고 전표(원 전표와 같은 일자·위치·수량)를 만들어 시리얼 연결을 옮김
--   4) thynC시스템 6종 시리얼 관리 해제 (수량은 그대로)
--   5) 서버(워크스테이션)이 구성품으로 잡힌 출고요청을 시스템 병상에 맞는 서버로 교체
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL TIME ZONE 'UTC';
SET LOCAL lock_timeout = '5s';

-- 시스템 ↔ 서버 대응 (품목코드 기준)
CREATE TEMP TABLE _map (sys_code text, sys_id int, srv_name text, srv_id int, srv_order int) ON COMMIT DROP;
INSERT INTO _map (sys_code, srv_name, srv_order) VALUES
  ('ITEM-0022', '서버(10병상)', 10), ('ITEM-0049', '서버(20병상)', 20), ('ITEM-0050', '서버(30병상)', 30),
  ('ITEM-0051', '서버(40병상)', 40), ('ITEM-0052', '서버(50병상)', 50), ('ITEM-0053', '서버(100병상)', 60);
UPDATE _map m SET sys_id = i.id FROM inventory_items i WHERE i.item_code = m.sys_code;

\echo == 0. 전제 검사
DO $$
DECLARE dw int; ws int; src int; m record; n bigint; q bigint;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'stock_out_component_kinds_source_item_id_key') THEN
    RAISE EXCEPTION '전제: 마이그 20261117100000_stock_out_kind_source_non_unique 를 먼저 적용하세요';
  END IF;
  SELECT id INTO dw FROM inventories WHERE name = '대웅제약재고';
  SELECT id INTO ws FROM inventory_items WHERE item_code = 'ITEM-0076' AND inventory_id = dw AND name = '서버(워크스테이션)' AND is_serial_managed;
  IF ws IS NULL THEN RAISE EXCEPTION '전제: 대웅제약재고 ITEM-0076 서버(워크스테이션)이 없습니다 (이미 적용됐을 수 있음)'; END IF;
  SELECT k.source_item_id INTO src FROM stock_out_component_kinds k WHERE k.item_id = ws;
  IF src IS NULL OR NOT EXISTS (SELECT 1 FROM inventory_items i JOIN inventories v ON v.id = i.inventory_id WHERE i.id = src AND i.item_code = 'ITEM-0069' AND v.name = 'thynC운영팀재고' AND i.is_serial_managed) THEN
    RAISE EXCEPTION '전제: ITEM-0076의 편입 대상이 thynC운영팀재고 ITEM-0069가 아닙니다';
  END IF;
  IF EXISTS (SELECT 1 FROM inventory_units WHERE item_id = ws) OR EXISTS (SELECT 1 FROM inventory_transactions WHERE item_id = ws)
     OR (SELECT coalesce(sum(quantity), 0) FROM inventory_stocks WHERE item_id = ws) <> 0 THEN
    RAISE EXCEPTION '전제: ITEM-0076에 재고·개체·전표가 있습니다';
  END IF;
  IF EXISTS (SELECT 1 FROM inventory_items WHERE inventory_id = dw AND name IN ('서버(10병상)', '서버(20병상)', '서버(30병상)', '서버(40병상)')) THEN
    RAISE EXCEPTION '전제: 서버(10~40병상) 품목이 이미 있습니다';
  END IF;
  IF (SELECT count(*) FROM inventory_items WHERE inventory_id = dw AND name IN ('서버(50병상)', '서버(100병상)') AND is_serial_managed AND id IN (SELECT item_id FROM stock_out_component_kinds)) <> 2 THEN
    RAISE EXCEPTION '전제: 대웅제약재고 서버(50병상)·서버(100병상) 구성품 품목을 찾을 수 없습니다';
  END IF;
  FOR m IN SELECT * FROM _map LOOP
    IF m.sys_id IS NULL OR NOT EXISTS (SELECT 1 FROM inventory_items WHERE id = m.sys_id AND inventory_id = dw AND is_serial_managed AND NOT is_lot_managed) THEN
      RAISE EXCEPTION '전제: % 가 대웅제약재고의 시리얼 관리 품목이 아닙니다 (이미 적용됐을 수 있음)', m.sys_code;
    END IF;
    SELECT count(*) INTO n FROM inventory_units WHERE item_id = m.sys_id;
    IF EXISTS (SELECT 1 FROM inventory_units WHERE item_id = m.sys_id AND (status <> 'IN_STOCK' OR warehouse_id IS NULL OR hospital_code IS NOT NULL OR coalesce(lot_no, '') <> '')) THEN
      RAISE EXCEPTION '전제: % 에 재고 상태가 아니거나 위치 없는 개체가 있습니다', m.sys_code;
    END IF;
    SELECT coalesce(sum(quantity), 0) INTO q FROM inventory_stocks WHERE item_id = m.sys_id;
    IF q <> n THEN RAISE EXCEPTION '전제: % 재고 수량 % ≠ 개체 수 %', m.sys_code, q, n; END IF;
    -- 개체마다 살아 있는 입고 전표 1건에만 연결돼 있어야 한다
    IF EXISTS (
      SELECT 1 FROM inventory_units u
      WHERE u.item_id = m.sys_id AND (
        (SELECT count(*) FROM inventory_transaction_units x WHERE x.unit_id = u.id) <> 1
        OR NOT EXISTS (SELECT 1 FROM inventory_transaction_units x JOIN inventory_transactions t ON t.id = x.transaction_id
                       WHERE x.unit_id = u.id AND t.item_id = m.sys_id AND t.tx_type = 'IN' AND t.canceled_at IS NULL AND t.warehouse_id = u.warehouse_id))
    ) THEN RAISE EXCEPTION '전제: % 개체의 전표 연결이 예상과 다릅니다', m.sys_code; END IF;
    RAISE NOTICE '% → % : 개체 %', m.sys_code, m.srv_name, n;
  END LOOP;
  -- 서버 품목(대웅·운영팀)에 같은 시리얼이 있으면 이관·이후 편입이 막힌다
  IF EXISTS (
    SELECT 1 FROM inventory_units u JOIN _map mm ON mm.sys_id = u.item_id
    JOIN inventory_units u2 ON u2.serial_no = u.serial_no AND u2.id <> u.id
    JOIN inventory_items i2 ON i2.id = u2.item_id WHERE i2.name LIKE '서버(%'
  ) THEN RAISE EXCEPTION '전제: 서버 품목에 같은 시리얼이 이미 있습니다'; END IF;
  -- 시스템50·100은 워크스테이션을 쓰지 않아야 한다
  IF EXISTS (SELECT 1 FROM stock_out_item_components c JOIN _map mm ON mm.sys_id = c.parent_item_id WHERE c.child_item_id = ws AND c.quantity > 0 AND mm.sys_code IN ('ITEM-0052', 'ITEM-0053')) THEN
    RAISE EXCEPTION '전제: 시스템50·100 구성에 서버(워크스테이션)이 들어 있습니다';
  END IF;
  RAISE NOTICE '전제 검사 통과';
END $$;

\echo == 1. 백업
CREATE TABLE public._bak_sys_split_items_20261117 AS SELECT i.* FROM inventory_items i WHERE i.id IN (SELECT sys_id FROM _map) OR i.item_code IN ('ITEM-0075', 'ITEM-0076', 'ITEM-0077');
CREATE TABLE public._bak_sys_split_units_20261117 AS SELECT u.* FROM inventory_units u WHERE u.item_id IN (SELECT sys_id FROM _map);
CREATE TABLE public._bak_sys_split_tx_units_20261117 AS SELECT x.* FROM inventory_transaction_units x JOIN inventory_units u ON u.id = x.unit_id WHERE u.item_id IN (SELECT sys_id FROM _map);
CREATE TABLE public._bak_sys_split_txs_20261117 AS SELECT t.* FROM inventory_transactions t WHERE t.item_id IN (SELECT sys_id FROM _map);
CREATE TABLE public._bak_sys_split_stocks_20261117 AS SELECT s.* FROM inventory_stocks s WHERE s.item_id IN (SELECT sys_id FROM _map) OR s.item_id IN (SELECT id FROM inventory_items WHERE item_code IN ('ITEM-0075', 'ITEM-0076', 'ITEM-0077'));
CREATE TABLE public._bak_sys_split_kinds_20261117 AS SELECT * FROM stock_out_component_kinds;
CREATE TABLE public._bak_sys_split_item_components_20261117 AS SELECT * FROM stock_out_item_components;
CREATE TABLE public._bak_sys_split_request_components_20261117 AS SELECT rc.* FROM stock_out_request_components rc WHERE rc.item_id = (SELECT id FROM inventory_items WHERE item_code = 'ITEM-0076');

\echo == 2. 품목 — ITEM-0076 개명, 서버(20·30·40병상) 신규
UPDATE inventory_items SET name = '서버(10병상)', model_name = '서버(10병상)', updated_at = now() WHERE item_code = 'ITEM-0076';
DO $$
DECLARE r record; base inventory_items%ROWTYPE; seq int; new_id int;
BEGIN
  SELECT * INTO base FROM inventory_items WHERE item_code = 'ITEM-0076';
  FOR r IN SELECT srv_name FROM _map WHERE srv_name IN ('서버(20병상)', '서버(30병상)', '서버(40병상)') ORDER BY srv_order LOOP
    SELECT coalesce(max(substring(item_code FROM 6)::int), 0) + 1 INTO seq FROM inventory_items WHERE item_code ~ '^ITEM-[0-9]+$';
    INSERT INTO inventory_items (
      item_code, name, category_id, spec, unit, is_serial_managed, is_lot_managed, device_info_id, ref_price, memo, is_active, sort_order,
      manufacturer_id, model_name, inventory_id, tags, udi_di, ledger_name, product_class, material_no, pack_unit, created_at, updated_at
    ) VALUES (
      'ITEM-' || lpad(seq::text, 4, '0'), r.srv_name, base.category_id, base.spec, base.unit, base.is_serial_managed, base.is_lot_managed, base.device_info_id, base.ref_price, base.memo, base.is_active, base.sort_order,
      base.manufacturer_id, r.srv_name, base.inventory_id, base.tags, base.udi_di, base.ledger_name, base.product_class, base.material_no, base.pack_unit, now(), now()
    ) RETURNING id INTO new_id;
    INSERT INTO stock_out_component_kinds (item_id, source_item_id, sort_order)
    VALUES (new_id, (SELECT source_item_id FROM stock_out_component_kinds WHERE item_id = base.id), 0);
  END LOOP;
END $$;
UPDATE _map m SET srv_id = i.id FROM inventory_items i JOIN inventories v ON v.id = i.inventory_id
 WHERE v.name = '대웅제약재고' AND i.name = m.srv_name AND i.id IN (SELECT item_id FROM stock_out_component_kinds);

\echo == 3. 구성품 종류 표시 순서 — 서버 병상순 먼저, 나머지는 기존 순서 유지
UPDATE stock_out_component_kinds k SET sort_order = x.ord
  FROM (
    SELECT k2.item_id,
           CASE WHEN m.srv_id IS NOT NULL THEN m.srv_order
                ELSE 60 + 10 * row_number() OVER (PARTITION BY (m.srv_id IS NULL) ORDER BY k2.sort_order, k2.item_id) END AS ord
      FROM stock_out_component_kinds k2 LEFT JOIN _map m ON m.srv_id = k2.item_id
  ) x WHERE x.item_id = k.item_id;

\echo == 4. 구성 설정 — 시스템 × 신규 서버 행 추가, 워크스테이션 수량을 같은 병상 서버로
INSERT INTO stock_out_item_components (parent_item_id, child_item_id, quantity, sort_order)
SELECT p.parent_item_id, k.item_id, 0, k.sort_order
  FROM (SELECT DISTINCT parent_item_id FROM stock_out_item_components) p CROSS JOIN stock_out_component_kinds k
ON CONFLICT (parent_item_id, child_item_id) DO NOTHING;
-- 시스템20·30·40: ITEM-0076(이제 10병상) 칸의 수량을 자기 병상 서버 칸으로 옮긴다
UPDATE stock_out_item_components c SET quantity = old.quantity
  FROM _map m JOIN stock_out_item_components old ON old.parent_item_id = m.sys_id AND old.child_item_id = (SELECT id FROM inventory_items WHERE item_code = 'ITEM-0076')
 WHERE c.parent_item_id = m.sys_id AND c.child_item_id = m.srv_id AND m.srv_name IN ('서버(20병상)', '서버(30병상)', '서버(40병상)');
UPDATE stock_out_item_components c SET quantity = 0
  FROM _map m WHERE c.parent_item_id = m.sys_id AND m.srv_name <> '서버(10병상)' AND c.child_item_id = (SELECT id FROM inventory_items WHERE item_code = 'ITEM-0076');
UPDATE stock_out_item_components c SET sort_order = k.sort_order FROM stock_out_component_kinds k WHERE k.item_id = c.child_item_id AND c.sort_order <> k.sort_order;

\echo == 5. 서버 품목 입고 전표 — 원 전표와 같은 일자·위치·수량, 시리얼 연결 이동
DO $$
DECLARE t record; prefix text; seq int; new_id int; new_code text;
BEGIN
  prefix := 'STK-' || to_char(now() AT TIME ZONE 'Asia/Seoul', 'YYYYMM') || '-';
  FOR t IN
    SELECT tx.*, m.srv_id, m.srv_name, si.name AS sys_name
      FROM inventory_transactions tx JOIN _map m ON m.sys_id = tx.item_id JOIN inventory_items si ON si.id = tx.item_id
     WHERE EXISTS (SELECT 1 FROM inventory_transaction_units x WHERE x.transaction_id = tx.id)
     ORDER BY tx.id
  LOOP
    SELECT coalesce(max(right(tx_code, 4)::int), 0) + 1 INTO seq FROM inventory_transactions WHERE tx_code LIKE prefix || '%';
    new_code := prefix || lpad(seq::text, 4, '0');
    INSERT INTO inventory_transactions (
      tx_code, tx_type, item_id, warehouse_id, quantity, note, actor_id, created_at, inventory_id, destination, reason_id, requester, lot_no, tx_date
    ) VALUES (
      new_code, 'IN', t.srv_id, t.warehouse_id, t.quantity,
      concat_ws(' ', nullif(t.note, ''), '[' || t.sys_name || '에서 개체 이관 — 원 전표 ' || t.tx_code || ']'),
      t.actor_id, now(), t.inventory_id, t.destination, t.reason_id, t.requester, t.lot_no, t.tx_date
    ) RETURNING id INTO new_id;
    UPDATE inventory_transaction_units SET transaction_id = new_id WHERE transaction_id = t.id;
    UPDATE inventory_transactions
       SET note = concat_ws(' ', nullif(note, ''), '[' || to_char(now() AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD') || ' 시리얼 관리 해제 — 개체는 ' || t.srv_name || ' ' || new_code || '로 이관, 이 전표는 수량 기록]')
     WHERE id = t.id;
    RAISE NOTICE '% % % → % %', t.tx_code, t.sys_name, t.quantity, t.srv_name, new_code;
  END LOOP;
END $$;

\echo == 6. 개체 이관 + 서버 품목 재고 행
UPDATE inventory_units u SET item_id = m.srv_id, updated_at = now() FROM _map m WHERE u.item_id = m.sys_id;
INSERT INTO inventory_stocks (item_id, warehouse_id, inventory_id, lot_no, quantity, updated_at)
SELECT u.item_id, u.warehouse_id, u.inventory_id, '', count(*), now()
  FROM inventory_units u JOIN _map m ON m.srv_id = u.item_id WHERE u.status = 'IN_STOCK'
 GROUP BY u.item_id, u.warehouse_id, u.inventory_id
ON CONFLICT (item_id, warehouse_id, inventory_id, lot_no) DO UPDATE SET quantity = EXCLUDED.quantity, updated_at = now();

\echo == 7. 시스템 6종 시리얼 관리 해제
UPDATE inventory_items i SET is_serial_managed = false, updated_at = now() FROM _map m WHERE i.id = m.sys_id;

\echo == 8. 출고요청 구성품 — 서버(워크스테이션) → 요청의 시스템 병상에 맞는 서버
DO $$
DECLARE rc record; n int; ws int;
BEGIN
  SELECT id INTO ws FROM inventory_items WHERE item_code = 'ITEM-0076';
  FOR rc IN SELECT c.*, r.sor_code FROM stock_out_request_components c JOIN stock_out_requests r ON r.id = c.request_id WHERE c.item_id = ws ORDER BY c.id LOOP
    -- 이 요청의 시스템10~40 라인 × 구성 수량
    SELECT count(*) INTO n FROM stock_out_request_items ri JOIN _map m ON m.sys_id = ri.inventory_item_id
     WHERE ri.request_id = rc.request_id AND m.srv_name IN ('서버(10병상)', '서버(20병상)', '서버(30병상)', '서버(40병상)');
    IF n = 0 THEN RAISE EXCEPTION '출고요청 %: 서버(워크스테이션) 구성품이 있는데 시스템10~40 라인이 없습니다', rc.sor_code; END IF;
    IF n > 1 AND (rc.unshipped_quantity > 0 OR rc.shipped_serials IS NOT NULL OR rc.unshipped_serials IS NOT NULL) THEN
      RAISE EXCEPTION '출고요청 %: 시스템 병상이 여러 종류인데 미출고·처리 시리얼이 있어 자동으로 나눌 수 없습니다', rc.sor_code;
    END IF;
    DELETE FROM stock_out_request_components WHERE id = rc.id;
    INSERT INTO stock_out_request_components (request_id, item_id, quantity, unshipped_quantity, shipped_serials, unshipped_serials, sort_order)
    SELECT rc.request_id, m.srv_id, sum(ri.quantity * c.quantity),
           CASE WHEN n = 1 THEN rc.unshipped_quantity ELSE 0 END,
           CASE WHEN n = 1 THEN rc.shipped_serials END, CASE WHEN n = 1 THEN rc.unshipped_serials END, k.sort_order
      FROM stock_out_request_items ri JOIN _map m ON m.sys_id = ri.inventory_item_id
      JOIN stock_out_item_components c ON c.parent_item_id = m.sys_id AND c.child_item_id = m.srv_id AND c.quantity > 0
      JOIN stock_out_component_kinds k ON k.item_id = m.srv_id
     WHERE ri.request_id = rc.request_id AND m.srv_name IN ('서버(10병상)', '서버(20병상)', '서버(30병상)', '서버(40병상)')
     GROUP BY m.srv_id, k.sort_order;
    IF (SELECT coalesce(sum(quantity), 0) FROM stock_out_request_components x JOIN _map m ON m.srv_id = x.item_id
         WHERE x.request_id = rc.request_id AND m.srv_name IN ('서버(10병상)', '서버(20병상)', '서버(30병상)', '서버(40병상)')) <> rc.quantity THEN
      RAISE EXCEPTION '출고요청 %: 바꾼 서버 구성품 합계가 원래 수량 % 와 다릅니다', rc.sor_code, rc.quantity;
    END IF;
    RAISE NOTICE '출고요청 % 구성품 교체 (수량 %)', rc.sor_code, rc.quantity;
  END LOOP;
  -- 구성품 표시 순서를 종류 순서로
  UPDATE stock_out_request_components c SET sort_order = k.sort_order FROM stock_out_component_kinds k WHERE k.item_id = c.item_id AND c.sort_order <> k.sort_order;
END $$;

\echo == 9. 감사 로그
INSERT INTO audit_logs (actor_name, actor_role, action, resource, resource_id, resource_label, before, after, created_at)
SELECT '운영 보정(Claude Code)', 'SYSTEM', 'UPDATE', 'inventory_item', m.sys_id::text,
       b.item_code || ' ' || b.name || ' 시리얼 관리 해제 — 개체 ' || (SELECT count(*) FROM inventory_units u WHERE u.item_id = m.srv_id) || '대를 ' || m.srv_name || '(으)로 이관, 수량 유지 (1회성 수동 보정)',
       jsonb_build_object('isSerialManaged', true),
       jsonb_build_object('isSerialManaged', false, 'unitsMovedTo', (SELECT item_code FROM inventory_items WHERE id = m.srv_id),
                          'quantity', (SELECT coalesce(sum(quantity), 0) FROM inventory_stocks s WHERE s.item_id = m.sys_id), 'backup', '_bak_sys_split_*_20261117'),
       now()
  FROM _map m JOIN public._bak_sys_split_items_20261117 b ON b.id = m.sys_id;
INSERT INTO audit_logs (actor_name, actor_role, action, resource, resource_id, resource_label, before, after, created_at)
SELECT '운영 보정(Claude Code)', 'SYSTEM', CASE WHEN b.id IS NULL THEN 'CREATE' ELSE 'UPDATE' END, 'inventory_item', i.id::text,
       i.item_code || ' ' || i.name || CASE WHEN b.id IS NULL THEN ' 신규 (서버 품목 병상별 분리)' ELSE ' — 서버(워크스테이션)에서 개명 (서버 품목 병상별 분리)' END,
       CASE WHEN b.id IS NULL THEN NULL ELSE jsonb_build_object('name', b.name, 'modelName', b.model_name) END,
       jsonb_build_object('name', i.name, 'modelName', i.model_name, 'inventory', '대웅제약재고', 'holdTarget', 'ITEM-0069 서버(워크스테이션) (thynC운영팀재고)'),
       now()
  FROM _map m JOIN inventory_items i ON i.id = m.srv_id LEFT JOIN public._bak_sys_split_items_20261117 b ON b.id = i.id
 WHERE m.srv_name IN ('서버(10병상)', '서버(20병상)', '서버(30병상)', '서버(40병상)');

\echo == 10. 사후 검증
DO $$
DECLARE m record; units bigint; sys_q bigint; srv_q bigint; linked bigint; total bigint := 0; bak bigint;
BEGIN
  FOR m IN SELECT * FROM _map ORDER BY srv_order LOOP
    IF m.srv_id IS NULL THEN RAISE EXCEPTION '사후: % 품목 없음', m.srv_name; END IF;
    IF EXISTS (SELECT 1 FROM inventory_units WHERE item_id = m.sys_id) THEN RAISE EXCEPTION '사후: % 에 개체가 남아 있습니다', m.sys_code; END IF;
    IF EXISTS (SELECT 1 FROM inventory_transaction_units x JOIN inventory_transactions t ON t.id = x.transaction_id WHERE t.item_id = m.sys_id) THEN
      RAISE EXCEPTION '사후: % 전표에 시리얼 연결이 남아 있습니다', m.sys_code;
    END IF;
    SELECT count(*) INTO units FROM inventory_units WHERE item_id = m.srv_id AND status = 'IN_STOCK';
    SELECT coalesce(sum(quantity), 0) INTO sys_q FROM inventory_stocks WHERE item_id = m.sys_id;
    SELECT coalesce(sum(quantity), 0) INTO srv_q FROM inventory_stocks WHERE item_id = m.srv_id;
    SELECT count(*) INTO linked FROM inventory_transaction_units x JOIN inventory_transactions t ON t.id = x.transaction_id JOIN inventory_units u ON u.id = x.unit_id
     WHERE t.item_id = m.srv_id AND u.item_id = m.srv_id AND t.tx_type = 'IN' AND t.canceled_at IS NULL;
    SELECT count(*) INTO bak FROM public._bak_sys_split_units_20261117 WHERE item_id = m.sys_id;
    IF NOT (units = sys_q AND units = srv_q AND units = linked AND units = bak) THEN
      RAISE EXCEPTION '사후: % 불일치 — 개체 % / 시스템 수량 % / 서버 수량 % / 전표 연결 % / 이관 전 %', m.srv_name, units, sys_q, srv_q, linked, bak;
    END IF;
    -- 전표 수량 합 = 재고 (서버 품목)
    IF (SELECT coalesce(sum(CASE WHEN tx_type = 'IN' THEN quantity ELSE -quantity END), 0) FROM inventory_transactions WHERE item_id = m.srv_id AND canceled_at IS NULL) <> srv_q THEN
      RAISE EXCEPTION '사후: % 전표 합계 ≠ 재고', m.srv_name;
    END IF;
    IF (SELECT is_serial_managed FROM inventory_items WHERE id = m.sys_id) OR NOT (SELECT is_serial_managed FROM inventory_items WHERE id = m.srv_id) THEN
      RAISE EXCEPTION '사후: % 시리얼 관리 설정', m.srv_name;
    END IF;
    -- 구성: 자기 병상 서버만 1 이상
    IF EXISTS (SELECT 1 FROM stock_out_item_components c JOIN _map m2 ON m2.srv_id = c.child_item_id
                WHERE c.parent_item_id = m.sys_id AND ((m2.srv_id = m.srv_id) <> (c.quantity > 0))) THEN
      RAISE EXCEPTION '사후: % 구성 설정', m.sys_code;
    END IF;
    total := total + units;
    RAISE NOTICE '% = % : 수량·개체 %', m.sys_code, m.srv_name, units;
  END LOOP;
  IF total <> (SELECT count(*) FROM public._bak_sys_split_units_20261117) THEN RAISE EXCEPTION '사후: 이관 개체 합계 %', total; END IF;
  -- 시리얼·개체 id·창고·등록일 불변
  IF EXISTS (SELECT 1 FROM public._bak_sys_split_units_20261117 b LEFT JOIN inventory_units u ON u.id = b.id
              WHERE u.id IS NULL OR u.serial_no <> b.serial_no OR u.warehouse_id IS DISTINCT FROM b.warehouse_id OR u.created_at <> b.created_at OR u.status <> b.status) THEN
    RAISE EXCEPTION '사후: 개체 속성이 바뀌었습니다';
  END IF;
  IF EXISTS (SELECT 1 FROM stock_out_request_components c JOIN inventory_items i ON i.id = c.item_id JOIN stock_out_requests r ON r.id = c.request_id
              WHERE i.item_code = 'ITEM-0076' AND NOT EXISTS (SELECT 1 FROM stock_out_request_items ri JOIN inventory_items si ON si.id = ri.inventory_item_id WHERE ri.request_id = r.id AND si.item_code = 'ITEM-0022')) THEN
    RAISE EXCEPTION '사후: 시스템10이 없는 요청에 서버(10병상) 구성품이 남았습니다';
  END IF;
  IF (SELECT count(*) FROM stock_out_item_components) <> (SELECT count(DISTINCT parent_item_id) FROM stock_out_item_components) * (SELECT count(*) FROM stock_out_component_kinds) THEN
    RAISE EXCEPTION '사후: 구성 설정 표가 시스템 × 종류 전 조합이 아닙니다';
  END IF;
  RAISE NOTICE '사후 검증 통과 — 이관 개체 %', total;
END $$;

SELECT i.item_code, i.name, i.model_name, v.name inventory, i.is_serial_managed serial,
       (SELECT coalesce(sum(quantity), 0) FROM inventory_stocks s WHERE s.item_id = i.id) qty,
       (SELECT count(*) FROM inventory_units u WHERE u.item_id = i.id) units,
       (SELECT count(*) FROM inventory_transactions t WHERE t.item_id = i.id AND t.canceled_at IS NULL) live_txs
  FROM inventory_items i JOIN inventories v ON v.id = i.inventory_id
 WHERE i.id IN (SELECT sys_id FROM _map UNION SELECT srv_id FROM _map) ORDER BY v.id, i.category_id, (SELECT srv_order FROM _map WHERE sys_id = i.id OR srv_id = i.id);
SELECT k.sort_order, i.item_code, i.name, s.item_code source_code, s.name source FROM stock_out_component_kinds k JOIN inventory_items i ON i.id = k.item_id JOIN inventory_items s ON s.id = k.source_item_id ORDER BY k.sort_order;
SELECT p.name parent, string_agg(ch.name || '=' || c.quantity, ' · ' ORDER BY c.sort_order) cfg
  FROM stock_out_item_components c JOIN inventory_items p ON p.id = c.parent_item_id JOIN inventory_items ch ON ch.id = c.child_item_id GROUP BY p.id, p.name ORDER BY p.id;
SELECT r.sor_code, i.name component, c.quantity, c.unshipped_quantity FROM stock_out_request_components c JOIN stock_out_requests r ON r.id = c.request_id JOIN inventory_items i ON i.id = c.item_id
 WHERE c.item_id IN (SELECT srv_id FROM _map) ORDER BY r.id, c.sort_order;

\echo == 종료 방식
\echo :finish
:finish;
