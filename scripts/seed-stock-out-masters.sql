-- 출고업무(출고요청) 마스터 시드 (projects/stock_out_request_design.md — 7번째 도메인 STOCK_OUT)
-- idempotent: PROD 최초 반영·데이터 동기화 후 재실행 가능 (CLAUDE.md 티켓 규칙 4)
--   psql -U thync -d thync_ops_dev -f scripts/seed-stock-out-masters.sql

-- 1) 출고요청 워크플로 상태 (STOCK_OUT_STATUS) + 티켓 상태 매핑 (규칙 6 — 매핑 필수)
--    요청→OPEN(담당 있으면 엔진이 ASSIGNED) / 처리중→IN_PROGRESS / 보류→PENDING(사유 '기타')
--    완료→CLOSED(2026-09-03 사용자 결정 — 완료 시 메인티켓 즉시 종결) / 취소→CLOSED
INSERT INTO status_codes (name, category, "order", color) VALUES
  ('요청',   'STOCK_OUT_STATUS', 10, '#3B82F6'),
  ('처리중', 'STOCK_OUT_STATUS', 20, '#F59E0B'),
  ('보류',   'STOCK_OUT_STATUS', 30, '#9CA3AF'),
  ('완료',   'STOCK_OUT_STATUS', 40, '#10B981'),
  ('취소',   'STOCK_OUT_STATUS', 50, '#6B7280')
ON CONFLICT (name, category) DO NOTHING;

-- 매핑은 관리자가 설정 화면에서 바꿀 수 있으므로 NULL(미매핑)인 행만 채운다
UPDATE status_codes SET ticket_status = 'OPEN'        WHERE category='STOCK_OUT_STATUS' AND name='요청'   AND ticket_status IS NULL;
UPDATE status_codes SET ticket_status = 'IN_PROGRESS' WHERE category='STOCK_OUT_STATUS' AND name='처리중' AND ticket_status IS NULL;
UPDATE status_codes SET ticket_status = 'PENDING',
  ticket_pending_reason_id = (SELECT id FROM ticket_pending_reasons WHERE name='기타')
  WHERE category='STOCK_OUT_STATUS' AND name='보류' AND ticket_status IS NULL;
UPDATE status_codes SET ticket_status = 'CLOSED'      WHERE category='STOCK_OUT_STATUS' AND name='완료'   AND ticket_status IS NULL;
UPDATE status_codes SET ticket_status = 'CLOSED'      WHERE category='STOCK_OUT_STATUS' AND name='취소'   AND ticket_status IS NULL;

-- 2) 출고 품목 노출 초기값 (v2 2026-11-01 — projects/stock_out_v2_design.md §9-4, 멱등)
--    구축(BUILD) = 대웅제약재고의 시스템 6종·MGW1010·MC200M-T·MP100W·MP1000F + L-* 4종. 유지보수·사업업무는 관리자가 설정 화면에서 지정
INSERT INTO stock_out_item_purposes (inventory_item_id, purpose)
SELECT ii.id, 'BUILD'
  FROM inventory_items ii
  JOIN inventories inv ON inv.id = ii.inventory_id AND inv.name = '대웅제약재고'
 WHERE ii.is_active
   AND ii.model_name IN ('thynC시스템10','thynC시스템20','thynC시스템30','thynC시스템40','thynC시스템50','thynC시스템100',
                         'MGW1010','MC200M-T','MP100W','MP1000F','L-MC200M-T','L-MP100W','L-MP2000F','L-MP2000R')
ON CONFLICT DO NOTHING;
