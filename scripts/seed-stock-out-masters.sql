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

-- 2) 출고 품목 마스터 12종 (그룹: SYSTEM 시스템 / WEARABLE 웨어러블 디바이스)
INSERT INTO stock_out_items (name, item_group, sort_order) VALUES
  ('thynC 시스템 10',  'SYSTEM', 10),
  ('thynC 시스템 20',  'SYSTEM', 20),
  ('thynC 시스템 30',  'SYSTEM', 30),
  ('thynC 시스템 40',  'SYSTEM', 40),
  ('thynC 시스템 50',  'SYSTEM', 50),
  ('thynC 시스템 100', 'SYSTEM', 60),
  ('MGW1010',          'SYSTEM', 70),
  ('MC200M-T', 'WEARABLE', 110),
  ('MP100W',   'WEARABLE', 120),
  ('MP1000F',  'WEARABLE', 130),
  ('MP2000F',  'WEARABLE', 140),
  ('MP2000R',  'WEARABLE', 150)
ON CONFLICT (name) DO NOTHING;

-- 3) 자동생성 규칙 — STOCK_OUT 기본 행 (dev 임시: ETC 기본 규칙의 CTI 재사용, queue는 CTI 기본 그룹 승계)
--    PROD는 사용자 신설 CTI로 설정 > '티켓 자동생성 규칙'에서 변경 (규칙 변경 비소급)
INSERT INTO ticket_domain_cti_rules (ref_type, match_status_code_id, cti_id, queue_id, fill_description, updated_at)
SELECT 'STOCK_OUT', NULL, r.cti_id, NULL, true, NOW()
FROM ticket_domain_cti_rules r
WHERE r.ref_type = 'ETC' AND r.match_status_code_id IS NULL
  AND NOT EXISTS (SELECT 1 FROM ticket_domain_cti_rules WHERE ref_type='STOCK_OUT' AND match_status_code_id IS NULL)
LIMIT 1;

-- 4) nav 메뉴 — 출고업무(운영현황, 프로젝트 관리 40 바로 아래 42) + 설정 2종
INSERT INTO nav_menu_items (menu_key, label, href, icon_key, parent_key, sort_order) VALUES
  ('stock-out-requests', '출고업무', '/stock-out-requests', 'package-out', 'operations', 42)
ON CONFLICT (menu_key) DO NOTHING;

INSERT INTO nav_menu_items (menu_key, label, href, parent_key, sort_order, group_label, allowed_roles) VALUES
  ('settings/stock-out-status', '출고업무 상태 관리', '/settings/stock-out-status', 'settings', 57, '업무 유형·상태', '{SUPER_ADMIN,ADMIN}'),
  ('settings/stock-out-items', '출고 품목 관리', '/settings/stock-out-items', 'settings', 82, '자재관리', '{SUPER_ADMIN,ADMIN}')
ON CONFLICT (menu_key) DO NOTHING;

-- 5) P2 — WMS 품목 매핑 키 (inventory_items.model_name 기준 인벤토리별 품목 해석, NULL만 백필)
UPDATE stock_out_items SET wms_model_name='thynC시스템10'  WHERE name='thynC 시스템 10'  AND wms_model_name IS NULL;
UPDATE stock_out_items SET wms_model_name='thynC시스템20'  WHERE name='thynC 시스템 20'  AND wms_model_name IS NULL;
UPDATE stock_out_items SET wms_model_name='thynC시스템30'  WHERE name='thynC 시스템 30'  AND wms_model_name IS NULL;
UPDATE stock_out_items SET wms_model_name='thynC시스템40'  WHERE name='thynC 시스템 40'  AND wms_model_name IS NULL;
UPDATE stock_out_items SET wms_model_name='thynC시스템50'  WHERE name='thynC 시스템 50'  AND wms_model_name IS NULL;
UPDATE stock_out_items SET wms_model_name='thynC시스템100' WHERE name='thynC 시스템 100' AND wms_model_name IS NULL;
UPDATE stock_out_items SET wms_model_name='MGW1010'  WHERE name='MGW1010'  AND wms_model_name IS NULL;
UPDATE stock_out_items SET wms_model_name='MC200M-T' WHERE name='MC200M-T' AND wms_model_name IS NULL;
UPDATE stock_out_items SET wms_model_name='MP100W'   WHERE name='MP100W'   AND wms_model_name IS NULL;
UPDATE stock_out_items SET wms_model_name='MP1000F'  WHERE name='MP1000F'  AND wms_model_name IS NULL;
UPDATE stock_out_items SET wms_model_name='MP2000F'  WHERE name='MP2000F'  AND wms_model_name IS NULL;
UPDATE stock_out_items SET wms_model_name='MP2000R'  WHERE name='MP2000R'  AND wms_model_name IS NULL;

-- 확인
SELECT name, "order", ticket_status FROM status_codes WHERE category='STOCK_OUT_STATUS' ORDER BY "order";
SELECT item_group, count(*) AS cnt, count(wms_model_name) AS mapped FROM stock_out_items GROUP BY item_group ORDER BY item_group;
SELECT r.ref_type, c.name AS cti_item, COALESCE(q.name,'(CTI 기본)') AS queue FROM ticket_domain_cti_rules r JOIN ticket_cti c ON r.cti_id=c.id LEFT JOIN ticket_queues q ON r.queue_id=q.id WHERE r.ref_type='STOCK_OUT';
SELECT menu_key, label, sort_order FROM nav_menu_items WHERE menu_key IN ('stock-out-requests','settings/stock-out-status','settings/stock-out-items') ORDER BY sort_order;
