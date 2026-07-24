-- 티켓 마스터 시드 (P4 — 2026-07-24 사용자 확정안)
-- 재실행 안전(idempotent): 존재하면 건너뜀. PROD 최초 반영 시에도 이 파일 사용.
-- 큐 4종 / PENDING 사유 5종 / CTI: 고객지원·영업·내부 3 Category, 각 Item에 기본 큐 라우팅

-- 1) 큐
INSERT INTO ticket_queues (name, description, sort_order) VALUES
  ('영업', '영업·견적·고객사 관계', 10),
  ('설치·답사', '현장 답사, 설치 계획·구축', 20),
  ('유지보수', '장애 대응, 고객 지원', 30),
  ('내부운영', '사내 시스템·자산·문서', 40)
ON CONFLICT (name) DO NOTHING;

-- 2) PENDING 사유
INSERT INTO ticket_pending_reasons (name, sort_order) VALUES
  ('외부 회신 대기', 10),
  ('자재·물품 대기', 20),
  ('일정 대기', 30),
  ('내부 결정 대기', 40),
  ('기타', 50)
ON CONFLICT (name) DO NOTHING;

-- 3) CTI 트리 (level1=Category, level2=Type, level3=Item + default_queue)
CREATE FUNCTION pg_temp.ensure_l1(p_name TEXT, p_sort INT) RETURNS INT AS $$
DECLARE v INT;
BEGIN
  INSERT INTO ticket_cti (name, level, sort_order) SELECT p_name, 1, p_sort
  WHERE NOT EXISTS (SELECT 1 FROM ticket_cti WHERE level = 1 AND name = p_name AND parent_id IS NULL);
  SELECT id INTO v FROM ticket_cti WHERE level = 1 AND name = p_name AND parent_id IS NULL;
  RETURN v;
END $$ LANGUAGE plpgsql;

CREATE FUNCTION pg_temp.ensure_l2(p_parent INT, p_name TEXT, p_sort INT) RETURNS INT AS $$
DECLARE v INT;
BEGIN
  INSERT INTO ticket_cti (name, level, parent_id, sort_order) SELECT p_name, 2, p_parent, p_sort
  WHERE NOT EXISTS (SELECT 1 FROM ticket_cti WHERE parent_id = p_parent AND name = p_name);
  SELECT id INTO v FROM ticket_cti WHERE parent_id = p_parent AND name = p_name;
  RETURN v;
END $$ LANGUAGE plpgsql;

CREATE FUNCTION pg_temp.ensure_l3(p_parent INT, p_name TEXT, p_queue INT, p_sort INT) RETURNS void AS $$
BEGIN
  INSERT INTO ticket_cti (name, level, parent_id, default_queue_id, sort_order)
  SELECT p_name, 3, p_parent, p_queue, p_sort
  WHERE NOT EXISTS (SELECT 1 FROM ticket_cti WHERE parent_id = p_parent AND name = p_name);
END $$ LANGUAGE plpgsql;

DO $$
DECLARE
  q_sales INT; q_maint INT; q_internal INT; q_install INT;
  cat INT; typ INT;
BEGIN
  SELECT id INTO q_sales FROM ticket_queues WHERE name = '영업';
  SELECT id INTO q_maint FROM ticket_queues WHERE name = '유지보수';
  SELECT id INTO q_internal FROM ticket_queues WHERE name = '내부운영';
  SELECT id INTO q_install FROM ticket_queues WHERE name = '설치·답사';

  -- 고객지원
  cat := pg_temp.ensure_l1('고객지원', 10);
  typ := pg_temp.ensure_l2(cat, '문의', 10);
  PERFORM pg_temp.ensure_l3(typ, '사용문의', q_maint, 10);
  PERFORM pg_temp.ensure_l3(typ, '데이터수정', q_maint, 20);
  PERFORM pg_temp.ensure_l3(typ, '기타', q_maint, 90);

  -- 고객지원/장애 — P5 유지보수 편입: MAINTENANCE_TYPE 4종과 1:1 매핑
  typ := pg_temp.ensure_l2(cat, '장애', 20);
  PERFORM pg_temp.ensure_l3(typ, '하드웨어', q_maint, 10);
  PERFORM pg_temp.ensure_l3(typ, '소프트웨어', q_maint, 20);
  PERFORM pg_temp.ensure_l3(typ, '네트워크', q_maint, 30);
  PERFORM pg_temp.ensure_l3(typ, '기타', q_maint, 90);

  -- 영업
  cat := pg_temp.ensure_l1('영업', 20);
  typ := pg_temp.ensure_l2(cat, '지원', 10);
  PERFORM pg_temp.ensure_l3(typ, '자료요청', q_sales, 10);
  PERFORM pg_temp.ensure_l3(typ, '견적지원', q_sales, 20);
  PERFORM pg_temp.ensure_l3(typ, '기타', q_sales, 90);

  -- 영업/신규도입 — P7 답사·P8 설치계획 편입용 (dev2에는 사용자 생성분 존재 — 기본 큐만 보정)
  typ := pg_temp.ensure_l2(cat, '신규도입', 20);
  PERFORM pg_temp.ensure_l3(typ, '답사요청', q_install, 10);
  PERFORM pg_temp.ensure_l3(typ, '설치계획(가안)요청', q_install, 20);
  PERFORM pg_temp.ensure_l3(typ, '구축', q_install, 30);
  UPDATE ticket_cti SET default_queue_id = q_install
    WHERE parent_id = typ AND name IN ('답사요청', '설치계획(가안)요청') AND default_queue_id IS NULL;

  -- 내부
  cat := pg_temp.ensure_l1('내부', 30);
  typ := pg_temp.ensure_l2(cat, '시스템', 10);
  PERFORM pg_temp.ensure_l3(typ, '개선요청', q_internal, 10);
  PERFORM pg_temp.ensure_l3(typ, '오류신고', q_internal, 20);
  PERFORM pg_temp.ensure_l3(typ, '권한요청', q_internal, 30);
  PERFORM pg_temp.ensure_l3(typ, '기타', q_internal, 90);

  typ := pg_temp.ensure_l2(cat, '자산', 20);
  PERFORM pg_temp.ensure_l3(typ, '차량', q_internal, 10);
  PERFORM pg_temp.ensure_l3(typ, '비품', q_internal, 20);
  PERFORM pg_temp.ensure_l3(typ, '기타', q_internal, 90);

  typ := pg_temp.ensure_l2(cat, '문서', 30);
  PERFORM pg_temp.ensure_l3(typ, '작성요청', q_internal, 10);
  PERFORM pg_temp.ensure_l3(typ, '검토요청', q_internal, 20);
  PERFORM pg_temp.ensure_l3(typ, '기타', q_internal, 90);

  -- 내부/기타업무 — P6 기타업무 편입
  typ := pg_temp.ensure_l2(cat, '기타업무', 40);
  PERFORM pg_temp.ensure_l3(typ, '일반', q_internal, 10);
  PERFORM pg_temp.ensure_l3(typ, '기타', q_internal, 90);
END $$;

DROP FUNCTION IF EXISTS pg_temp.ensure_l1(TEXT, INT);
DROP FUNCTION IF EXISTS pg_temp.ensure_l2(INT, TEXT, INT);
DROP FUNCTION IF EXISTS pg_temp.ensure_l3(INT, TEXT, INT, INT);

-- 4) nav 메뉴 (PROD 최초 반영·데이터 동기화 후 재INSERT용)
INSERT INTO nav_menu_items (menu_key, label, href, icon_key, sort_order) VALUES
  ('tickets', '티켓', '/tickets', 'ticket', 18)
ON CONFLICT (menu_key) DO NOTHING;
INSERT INTO nav_menu_items (menu_key, label, href, parent_key, sort_order, group_label) VALUES
  ('settings/ticket-queues', '티켓 큐 관리', '/settings/ticket-queues', 'settings', 60, '티켓'),
  ('settings/ticket-cti', '티켓 분류(CTI) 관리', '/settings/ticket-cti', 'settings', 62, '티켓'),
  ('settings/ticket-pending-reasons', '티켓 대기 사유 관리', '/settings/ticket-pending-reasons', 'settings', 64, '티켓')
ON CONFLICT (menu_key) DO NOTHING;

-- P10: tasks 롤업 메뉴 비활성 (티켓 목록이 대체 — /tasks는 /tickets로 리다이렉트)
UPDATE nav_menu_items SET is_active = false WHERE menu_key = 'tasks' AND is_active = true;
