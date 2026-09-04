-- AS업무(AS접수) 마스터 시드 (projects/as_work_design.md — 8번째 도메인 AS)
-- idempotent: PROD 최초 반영·데이터 동기화 후 재실행 가능 (CLAUDE.md 티켓 규칙 4)
--   psql -U thync -d thync_ops_dev -f scripts/seed-as-masters.sql

-- 1) AS접수 워크플로 상태 (AS_STATUS, 단계형 8종) + 티켓 상태 매핑 (규칙 6 — 매핑 필수)
--    접수→OPEN(담당 있으면 엔진이 ASSIGNED) / 수거중·입고·처리중·발송→IN_PROGRESS / 보류→PENDING(사유 '기타')
--    완료→CLOSED(2026-09-04 결정 — SOR 선례, RESOLVED 미경유) / 취소→CLOSED
INSERT INTO status_codes (name, category, "order", color) VALUES
  ('접수',   'AS_STATUS', 10, '#3B82F6'),
  ('수거중', 'AS_STATUS', 20, '#8B5CF6'),
  ('입고',   'AS_STATUS', 30, '#06B6D4'),
  ('처리중', 'AS_STATUS', 40, '#F59E0B'),
  ('발송',   'AS_STATUS', 50, '#F97316'),
  ('완료',   'AS_STATUS', 60, '#10B981'),
  ('보류',   'AS_STATUS', 70, '#9CA3AF'),
  ('취소',   'AS_STATUS', 80, '#6B7280')
ON CONFLICT (name, category) DO NOTHING;

-- 매핑은 관리자가 설정 화면에서 바꿀 수 있으므로 NULL(미매핑)인 행만 채운다
UPDATE status_codes SET ticket_status = 'OPEN'        WHERE category='AS_STATUS' AND name='접수'   AND ticket_status IS NULL;
UPDATE status_codes SET ticket_status = 'IN_PROGRESS' WHERE category='AS_STATUS' AND name IN ('수거중','입고','처리중','발송') AND ticket_status IS NULL;
UPDATE status_codes SET ticket_status = 'PENDING',
  ticket_pending_reason_id = (SELECT id FROM ticket_pending_reasons WHERE name='기타')
  WHERE category='AS_STATUS' AND name='보류' AND ticket_status IS NULL;
UPDATE status_codes SET ticket_status = 'CLOSED'      WHERE category='AS_STATUS' AND name='완료'   AND ticket_status IS NULL;
UPDATE status_codes SET ticket_status = 'CLOSED'      WHERE category='AS_STATUS' AND name='취소'   AND ticket_status IS NULL;

-- 2) 자동생성 규칙 — AS 기본 행 (dev 임시: ETC 기본 규칙의 CTI 재사용, queue는 CTI 기본 그룹 승계)
--    PROD는 사용자 신설 CTI로 설정 > '티켓 자동생성 규칙'에서 변경 (규칙 변경 비소급 — SOR 선례)
INSERT INTO ticket_domain_cti_rules (ref_type, match_status_code_id, cti_id, queue_id, fill_description, updated_at)
SELECT 'AS', NULL, r.cti_id, NULL, true, NOW()
FROM ticket_domain_cti_rules r
WHERE r.ref_type = 'ETC' AND r.match_status_code_id IS NULL
  AND NOT EXISTS (SELECT 1 FROM ticket_domain_cti_rules WHERE ref_type='AS' AND match_status_code_id IS NULL)
LIMIT 1;

-- 3) nav 메뉴 — AS업무(운영현황, 유지보수 50 바로 아래 52) + 설정 상태 관리
INSERT INTO nav_menu_items (menu_key, label, href, icon_key, parent_key, sort_order) VALUES
  ('as-receipts', 'AS업무', '/as-receipts', 'repair', 'operations', 52)
ON CONFLICT (menu_key) DO NOTHING;

INSERT INTO nav_menu_items (menu_key, label, href, parent_key, sort_order, group_label, allowed_roles) VALUES
  ('settings/as-status', 'AS업무 상태 관리', '/settings/as-status', 'settings', 59, '업무 유형·상태', '{SUPER_ADMIN,ADMIN}')
ON CONFLICT (menu_key) DO NOTHING;

-- 확인
SELECT name, "order", ticket_status FROM status_codes WHERE category='AS_STATUS' ORDER BY "order";
SELECT r.ref_type, c.name AS cti_item, COALESCE(q.name,'(CTI 기본)') AS queue FROM ticket_domain_cti_rules r JOIN ticket_cti c ON r.cti_id=c.id LEFT JOIN ticket_queues q ON r.queue_id=q.id WHERE r.ref_type='AS';
SELECT menu_key, label, sort_order FROM nav_menu_items WHERE menu_key IN ('as-receipts','settings/as-status') ORDER BY sort_order;
