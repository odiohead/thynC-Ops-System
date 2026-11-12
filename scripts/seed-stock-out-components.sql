-- ⚠ 2026-11-12 이후 재실행 금지 — 구성품이 대웅제약재고 복제 품목(stock_out_component_kinds)으로 바뀌었다.
--   이 파일은 2026-11-01 최초 구성(운영팀재고 품목 직접 참조) 기록용. 현재 절차: scripts/seed-stock-out-component-kinds.sql + 설정 > 출고 품목 관리 > 구성 탭(수량만)
-- 출고요청 품목 구성 시드 — thynC 시스템 XX(대웅제약재고) 1개당 thynC운영팀재고 부자재 (2026-11-01 사용자 제공 구성, 멱등)
--   psql -U thync -d thync_ops_dev -f scripts/seed-stock-out-components.sql
-- 10/20/30: 서버(워크스테이션)1·매니저PC 2·27인치 모니터 1·50인치 사이니지 1
-- 40      : 서버(워크스테이션)1·매니저PC 2·27인치 모니터 1·50인치 사이니지 2
-- 50      : 서버(50병상)1·매니저PC 2·27인치 모니터 1·50인치 사이니지 2
-- 100     : 서버(100병상)1·매니저PC 2·27인치 모니터 1·50인치 사이니지 2 (2026-11-01 정정)
-- 정정: 시스템100 ↔ 서버(워크스테이션) 구행 제거
DELETE FROM stock_out_item_components x USING inventory_items p, inventory_items c
 WHERE x.parent_item_id = p.id AND x.child_item_id = c.id AND p.model_name = 'thynC시스템100' AND c.name = '서버(워크스테이션)';

WITH p AS (
  SELECT ii.id, ii.model_name FROM inventory_items ii JOIN inventories inv ON inv.id = ii.inventory_id
   WHERE inv.name = '대웅제약재고' AND ii.model_name IN ('thynC시스템10','thynC시스템20','thynC시스템30','thynC시스템40','thynC시스템50','thynC시스템100')
), c AS (
  SELECT ii.id, ii.name FROM inventory_items ii JOIN inventories inv ON inv.id = ii.inventory_id
   WHERE inv.name = 'thynC운영팀재고' AND ii.name IN ('서버(워크스테이션)','서버(50병상)','서버(100병상)','매니저PC','27인치 모니터','50인치 사이니지')
), spec(model, child, qty, ord) AS (VALUES
  ('thynC시스템10','서버(워크스테이션)',1,1),('thynC시스템10','매니저PC',2,2),('thynC시스템10','27인치 모니터',1,3),('thynC시스템10','50인치 사이니지',1,4),
  ('thynC시스템20','서버(워크스테이션)',1,1),('thynC시스템20','매니저PC',2,2),('thynC시스템20','27인치 모니터',1,3),('thynC시스템20','50인치 사이니지',1,4),
  ('thynC시스템30','서버(워크스테이션)',1,1),('thynC시스템30','매니저PC',2,2),('thynC시스템30','27인치 모니터',1,3),('thynC시스템30','50인치 사이니지',1,4),
  ('thynC시스템40','서버(워크스테이션)',1,1),('thynC시스템40','매니저PC',2,2),('thynC시스템40','27인치 모니터',1,3),('thynC시스템40','50인치 사이니지',2,4),
  ('thynC시스템50','서버(50병상)',1,1),('thynC시스템50','매니저PC',2,2),('thynC시스템50','27인치 모니터',1,3),('thynC시스템50','50인치 사이니지',2,4),
  ('thynC시스템100','서버(100병상)',1,1),('thynC시스템100','매니저PC',2,2),('thynC시스템100','27인치 모니터',1,3),('thynC시스템100','50인치 사이니지',2,4)
)
INSERT INTO stock_out_item_components (parent_item_id, child_item_id, quantity, sort_order)
SELECT p.id, c.id, spec.qty, spec.ord FROM spec JOIN p ON p.model_name = spec.model JOIN c ON c.name = spec.child
ON CONFLICT (parent_item_id, child_item_id) DO UPDATE SET quantity = EXCLUDED.quantity, sort_order = EXCLUDED.sort_order;
