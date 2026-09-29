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

-- 7) 2026-09-28 채널톡 상담 원천 적재 — 설정 nav (연동·알림 그룹, 메일 동기화 옆). 열람 /voc/inbox는 사용자 지시로 nav 미등록
INSERT INTO nav_menu_items (menu_key, label, href, parent_key, sort_order, group_label, allowed_roles) VALUES
  ('settings/channeltalk-sync', '채널톡 상담 적재', '/settings/channeltalk-sync', 'settings', 103, '연동·알림', '{SUPER_ADMIN,ADMIN}')
ON CONFLICT (menu_key) DO NOTHING;

-- 8) 2026-09-28 채널톡 상담 → VOC 승격 (voc_channeltalk_promotion_design.md)
--    접수 채널 '채널톡' + VOC 분류를 채널톡 분류 태그 체계(a~h 대분류 / 소분류)로 재편 — name='대분류/소분류', value=채널톡 태그명(매핑 키)
INSERT INTO status_codes (name, category, "order", color) VALUES ('채널톡', 'VOC_CHANNEL', 5, '#F97316') ON CONFLICT (name, category) DO NOTHING;

INSERT INTO status_codes (name, value, category, "order", color) VALUES
  ('오류SW/데이터',            'a_오류SW_데이터',               'VOC_TYPE', 110, '#EF4444'),
  ('오류SW/레포트',            'a_오류SW_레포트',               'VOC_TYPE', 111, '#EF4444'),
  ('오류SW/알람',              'a_오류SW_알람',                 'VOC_TYPE', 112, '#EF4444'),
  ('오류SW/접속',              'a_오류SW_접속',                 'VOC_TYPE', 113, '#EF4444'),
  ('오류SW/화면',              'a_오류SW_화면',                 'VOC_TYPE', 114, '#EF4444'),
  ('오류HW/디바이스',          'b_오류HW_디바이스',             'VOC_TYPE', 120, '#DC2626'),
  ('오류HW/운영장비',          'b_오류HW_운영장비',             'VOC_TYPE', 121, '#DC2626'),
  ('EMR/연동오류',             'c_EMR_연동오류',                'VOC_TYPE', 130, '#F59E0B'),
  ('EMR/이용-현황문의',        'c_EMR_이용-현황문의',           'VOC_TYPE', 131, '#F59E0B'),
  ('사용/계정',                'd_사용_계정',                   'VOC_TYPE', 140, '#0EA5E9'),
  ('사용/기본사용',            'd_사용_기본사용',               'VOC_TYPE', 141, '#0EA5E9'),
  ('사용/레포트',              'd_사용_레포트',                 'VOC_TYPE', 142, '#0EA5E9'),
  ('사용/알람',                'd_사용_알람',                   'VOC_TYPE', 143, '#0EA5E9'),
  ('사용/화면',                'd_사용_화면',                   'VOC_TYPE', 144, '#0EA5E9'),
  ('운영/교육',                'e_운영_교육',                   'VOC_TYPE', 150, '#8B5CF6'),
  ('운영/기기관리-조작요청',   'e_운영_기기관리-조작요청',      'VOC_TYPE', 151, '#8B5CF6'),
  ('운영/병동-환자관리-조작요청','e_운영_병동-환자관리-조작요청','VOC_TYPE', 152, '#8B5CF6'),
  ('운영/설치-점검',           'e_운영_설치-점검',              'VOC_TYPE', 153, '#8B5CF6'),
  ('운영/요금-계약',           'e_운영_요금-계약',              'VOC_TYPE', 154, '#8B5CF6'),
  ('AS/고장접수',              'f_AS_고장접수',                 'VOC_TYPE', 160, '#10B981'),
  ('AS/분실접수',              'f_AS_분실접수',                 'VOC_TYPE', 161, '#10B981'),
  ('AS/소모품-부속품',         'f_AS_소모품-부속품',            'VOC_TYPE', 162, '#10B981'),
  ('AS/진행상황문의',          'f_AS_진행상황문의',             'VOC_TYPE', 163, '#10B981'),
  ('개선/UIUX',                'g_개선_UIUX',                   'VOC_TYPE', 170, '#6366F1'),
  ('개선/디바이스',            'g_개선_디바이스',               'VOC_TYPE', 171, '#6366F1'),
  ('개선/서비스',              'g_개선_서비스',                 'VOC_TYPE', 172, '#6366F1'),
  ('타사/HW',                  'h_타사_HW',                     'VOC_TYPE', 180, '#6B7280'),
  ('타사/SW',                  'h_타사_SW',                     'VOC_TYPE', 181, '#6B7280')
ON CONFLICT (name, category) DO UPDATE SET value = EXCLUDED.value, "order" = EXCLUDED."order", color = EXCLUDED.color;

-- 구 6종(불만·장애·요청·문의·칭찬·기타)은 참조가 없을 때만 제거 (dev2·PROD 모두 voc_receipts 0건 확인 2026-09-28)
DELETE FROM status_codes s WHERE s.category = 'VOC_TYPE' AND s.value IS NULL
  AND NOT EXISTS (SELECT 1 FROM voc_receipts v WHERE v.voc_type_id = s.id)
  AND NOT EXISTS (SELECT 1 FROM ticket_domain_cti_rules r WHERE r.match_status_code_id = s.id);

SELECT count(*) AS voc_types FROM status_codes WHERE category = 'VOC_TYPE';
