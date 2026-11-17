-- 출고요청 시스템 구성품 보정 — 구성품 기록이 없는 미처리 요청에 현재 구성 설정으로 구성품 행을 채운다 (멱등)
--   psql -v ON_ERROR_STOP=1 -v finish=ROLLBACK -f scripts/backfill-stock-out-request-components.sql   # dry-run
--   psql -v ON_ERROR_STOP=1 -v finish=COMMIT   -f scripts/backfill-stock-out-request-components.sql   # 적용
-- 배경 (projects/system_server_split_design.md §11): 구성품 행은 요청을 저장할 때 만들어진다. 2026-11-12 구성품 개편 전에 등록되고
--   그 뒤 다시 저장하지 않은 요청에는 행이 없다. 시스템이 수량 품목이 된 뒤에는 이런 요청을 출고 처리하면 서버 시리얼을 받는 칸이 없다.
-- 대상: 출고 처리 전(fulfilled_at 없음)·종결 전(완료·취소 아님)·분실 AS 연동 아님·구성품 행 0건이면서, 요청 품목에 구성이 설정된 시스템이 있는 요청.
-- 채우는 값: 구성품 종류별 Σ(시스템 라인 수량 × 구성 수량), 미출고 0 — 요청을 [수정]에서 그대로 저장했을 때와 같다.
-- 실행 순서: scripts/migrate-system-units-to-servers.sql 다음(병상별 서버 구성이 반영된 뒤).
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE TEMP TABLE _targets ON COMMIT DROP AS
SELECT r.id AS request_id, r.sor_code
  FROM stock_out_requests r LEFT JOIN status_codes sc ON sc.id = r.status_id
 WHERE r.fulfilled_at IS NULL AND r.as_receipt_id IS NULL
   AND coalesce(sc.ticket_status::text, '') NOT IN ('RESOLVED', 'CLOSED')
   AND NOT EXISTS (SELECT 1 FROM stock_out_request_components c WHERE c.request_id = r.id)
   AND EXISTS (
     SELECT 1 FROM stock_out_request_items ri
       JOIN stock_out_item_components c ON c.parent_item_id = ri.inventory_item_id AND c.quantity > 0
       JOIN stock_out_component_kinds k ON k.item_id = c.child_item_id
      WHERE ri.request_id = r.id);

\echo == 대상 요청
SELECT t.sor_code,
       (SELECT string_agg(i.name || ' x' || ri.quantity, ', ' ORDER BY ri.id) FROM stock_out_request_items ri JOIN inventory_items i ON i.id = ri.inventory_item_id
         WHERE ri.request_id = t.request_id AND EXISTS (SELECT 1 FROM stock_out_item_components c WHERE c.parent_item_id = ri.inventory_item_id AND c.quantity > 0)) AS systems
  FROM _targets t ORDER BY t.request_id;

INSERT INTO stock_out_request_components (request_id, item_id, quantity, unshipped_quantity, sort_order)
SELECT t.request_id, k.item_id, sum(ri.quantity * c.quantity), 0, k.sort_order
  FROM _targets t
  JOIN stock_out_request_items ri ON ri.request_id = t.request_id
  JOIN stock_out_item_components c ON c.parent_item_id = ri.inventory_item_id AND c.quantity > 0
  JOIN stock_out_component_kinds k ON k.item_id = c.child_item_id
 GROUP BY t.request_id, k.item_id, k.sort_order;

-- 구성품 품목이 요청 품목에도 직접 들어 있으면 출고 처리에서 막힌다 — 미리 알린다
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT t.sor_code, i.name FROM _targets t JOIN stock_out_request_components c ON c.request_id = t.request_id
            JOIN stock_out_request_items ri ON ri.request_id = t.request_id AND ri.inventory_item_id = c.item_id JOIN inventory_items i ON i.id = c.item_id
  LOOP RAISE WARNING '%: %이(가) 요청 품목과 구성품에 함께 있습니다 — 요청 품목에서 빼야 출고 처리됩니다', r.sor_code, r.name; END LOOP;
END $$;

\echo == 채운 구성품
SELECT t.sor_code, string_agg(i.name || ' ' || c.quantity, ' · ' ORDER BY c.sort_order) AS components
  FROM _targets t JOIN stock_out_request_components c ON c.request_id = t.request_id JOIN inventory_items i ON i.id = c.item_id
 GROUP BY t.request_id, t.sor_code ORDER BY t.request_id;

\echo == 남은 대상 (0이어야 한다)
SELECT count(*) AS remaining
  FROM stock_out_requests r LEFT JOIN status_codes sc ON sc.id = r.status_id
 WHERE r.fulfilled_at IS NULL AND r.as_receipt_id IS NULL AND coalesce(sc.ticket_status::text, '') NOT IN ('RESOLVED', 'CLOSED')
   AND NOT EXISTS (SELECT 1 FROM stock_out_request_components c WHERE c.request_id = r.id)
   AND EXISTS (SELECT 1 FROM stock_out_request_items ri JOIN stock_out_item_components c ON c.parent_item_id = ri.inventory_item_id AND c.quantity > 0
                JOIN stock_out_component_kinds k ON k.item_id = c.child_item_id WHERE ri.request_id = r.id);

\echo :finish
:finish;
