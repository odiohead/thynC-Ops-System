-- CS 티켓 워크플로 마스터 시드 (cs_ticket_workflow_design.md — VOC접수)
-- 2026-08-15 개정: 콜기록지 기능 제거(사용자 결정)로 CALL_INQUIRY_TYPE·콜 nav 시드 삭제
-- idempotent: PROD 최초 반영·데이터 동기화 후 재실행 가능 (CLAUDE.md 티켓 규칙 4)
--   psql -U thync -d thync_ops_dev -f scripts/seed-cs-masters.sql

-- 1) VOC 접수 채널 (VOC_CHANNEL)
INSERT INTO status_codes (name, category, "order", color) VALUES
  ('전화', 'VOC_CHANNEL', 10, '#0EA5E9'),
  ('메일', 'VOC_CHANNEL', 20, '#8B5CF6'),
  ('방문', 'VOC_CHANNEL', 30, '#10B981'),
  ('기타', 'VOC_CHANNEL', 90, '#9CA3AF')
ON CONFLICT (name, category) DO NOTHING;

-- 2) VOC 분류 (VOC_TYPE — 자동생성 규칙의 조건 축)
INSERT INTO status_codes (name, category, "order", color) VALUES
  ('불만', 'VOC_TYPE', 10, '#EF4444'),
  ('장애', 'VOC_TYPE', 20, '#F59E0B'),
  ('요청', 'VOC_TYPE', 30, '#0EA5E9'),
  ('문의', 'VOC_TYPE', 40, '#6B7280'),
  ('칭찬', 'VOC_TYPE', 50, '#10B981'),
  ('기타', 'VOC_TYPE', 90, '#9CA3AF')
ON CONFLICT (name, category) DO NOTHING;

-- 3) VOC 워크플로 상태 (VOC_STATUS) + 티켓 상태 매핑 (규칙 6 — 매핑 필수)
--    접수→OPEN(담당 있으면 엔진이 ASSIGNED) / 처리중→IN_PROGRESS / 보류→PENDING(사유 '기타')
--    회신완료→RESOLVED (자동 종결 배치 대상) / 종결→CLOSED
INSERT INTO status_codes (name, category, "order", color) VALUES
  ('접수',     'VOC_STATUS', 10, '#3B82F6'),
  ('처리중',   'VOC_STATUS', 20, '#F59E0B'),
  ('보류',     'VOC_STATUS', 30, '#9CA3AF'),
  ('회신완료', 'VOC_STATUS', 40, '#10B981'),
  ('종결',     'VOC_STATUS', 50, '#6B7280')
ON CONFLICT (name, category) DO NOTHING;

-- 매핑은 관리자가 설정 화면에서 바꿀 수 있으므로 NULL(미매핑)인 행만 채운다
UPDATE status_codes SET ticket_status = 'OPEN'        WHERE category = 'VOC_STATUS' AND name = '접수'     AND ticket_status IS NULL;
UPDATE status_codes SET ticket_status = 'IN_PROGRESS' WHERE category = 'VOC_STATUS' AND name = '처리중'   AND ticket_status IS NULL;
UPDATE status_codes SET ticket_status = 'PENDING',
  ticket_pending_reason_id = (SELECT id FROM ticket_pending_reasons WHERE name = '기타')
  WHERE category = 'VOC_STATUS' AND name = '보류' AND ticket_status IS NULL;
UPDATE status_codes SET ticket_status = 'RESOLVED'    WHERE category = 'VOC_STATUS' AND name = '회신완료' AND ticket_status IS NULL;
UPDATE status_codes SET ticket_status = 'CLOSED'      WHERE category = 'VOC_STATUS' AND name = '종결'     AND ticket_status IS NULL;

-- 4) Assignment Group 'CS' + CTI 고객지원 > VOC > 일반 (기본 그룹 CS)
INSERT INTO ticket_queues (name, description, sort_order, updated_at)
VALUES ('CS', 'CS 접수(VOC) 처리 그룹', 25, NOW())
ON CONFLICT (name) DO NOTHING;

DO $$
DECLARE
  q_cs INT; cat INT; typ INT;
BEGIN
  SELECT id INTO q_cs FROM ticket_queues WHERE name = 'CS';

  SELECT id INTO cat FROM ticket_cti WHERE level = 1 AND name = '고객지원' AND parent_id IS NULL;
  IF cat IS NULL THEN
    INSERT INTO ticket_cti (parent_id, level, name, sort_order, updated_at) VALUES (NULL, 1, '고객지원', 10, NOW()) RETURNING id INTO cat;
  END IF;

  SELECT id INTO typ FROM ticket_cti WHERE parent_id = cat AND name = 'VOC';
  IF typ IS NULL THEN
    INSERT INTO ticket_cti (parent_id, level, name, sort_order, updated_at) VALUES (cat, 2, 'VOC', 30, NOW()) RETURNING id INTO typ;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM ticket_cti WHERE parent_id = typ AND name = '일반') THEN
    INSERT INTO ticket_cti (parent_id, level, name, default_queue_id, sort_order, updated_at) VALUES (typ, 3, '일반', q_cs, 10, NOW());
  END IF;

  -- 5) 자동생성 규칙 — VOC 기본 행 (조건 없음, CTI 고객지원>VOC>일반, 그룹 CS, 설명 자동입력)
  IF NOT EXISTS (SELECT 1 FROM ticket_domain_cti_rules WHERE ref_type = 'VOC' AND match_status_code_id IS NULL) THEN
    INSERT INTO ticket_domain_cti_rules (ref_type, match_status_code_id, cti_id, queue_id, fill_description, updated_at)
    SELECT 'VOC', NULL, c.id, q_cs, true, NOW()
    FROM ticket_cti c JOIN ticket_cti p ON c.parent_id = p.id
    WHERE c.name = '일반' AND p.name = 'VOC' AND p.parent_id = (SELECT id FROM ticket_cti WHERE level = 1 AND name = '고객지원' AND parent_id IS NULL);
  END IF;
END $$;

-- 6) nav 메뉴 — VOC 접수(운영현황 하위, 유지보수 앞 — 2026-08-16 nav 개편 반영) + 설정 2종
INSERT INTO nav_menu_items (menu_key, label, href, icon_key, parent_key, sort_order) VALUES
  ('voc', 'VOC 접수', '/voc', 'voc', 'operations', 45)
ON CONFLICT (menu_key) DO NOTHING;

INSERT INTO nav_menu_items (menu_key, label, href, parent_key, sort_order, group_label, allowed_roles) VALUES
  ('settings/voc-status', 'VOC 상태 관리', '/settings/voc-status', 'settings', 53, '업무 유형·상태', '{SUPER_ADMIN,ADMIN}'),
  ('settings/voc-type', 'VOC 분류 관리', '/settings/voc-type', 'settings', 55, '업무 유형·상태', '{SUPER_ADMIN,ADMIN}')
ON CONFLICT (menu_key) DO NOTHING;

-- 확인
SELECT category, count(*) FROM status_codes WHERE category IN ('VOC_CHANNEL','VOC_TYPE','VOC_STATUS') GROUP BY category ORDER BY category;
SELECT r.ref_type, c.name AS cti_item, q.name AS queue FROM ticket_domain_cti_rules r JOIN ticket_cti c ON r.cti_id = c.id LEFT JOIN ticket_queues q ON r.queue_id = q.id WHERE r.ref_type = 'VOC';
