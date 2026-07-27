-- 도메인↔티켓 상태 매핑 시드 (ticket_status_map_design.md §4)
-- idempotent: 매핑이 NULL인 행만 채운다 — 운영자가 설정 화면에서 바꾼 매핑은 재실행해도 덮어쓰지 않음.
-- 값은 기존 lib/ticketDomain.ts 하드코딩과 동일 — 적용 직후 동작 100% 동일.
-- PROD 최초 반영 시 실행. 매핑 마스터 변경 시 이 파일도 동반 갱신.

-- 0) 설치계획 단일 축 상태코드 (INSTALL_PLAN_STATUS — 결정②B, §7)
INSERT INTO status_codes (name, category, color, "order")
VALUES
  ('접수',     'INSTALL_PLAN_STATUS', '#3B82F6', 1),
  ('작성완료', 'INSTALL_PLAN_STATUS', '#F59E0B', 2),
  ('회신완료', 'INSTALL_PLAN_STATUS', '#10B981', 3),
  ('보류',     'INSTALL_PLAN_STATUS', '#9CA3AF', 4)
ON CONFLICT (name, category) DO NOTHING;

-- 1) 접수 → OPEN (owner 있으면 엔진이 ASSIGNED 판정)
UPDATE status_codes SET ticket_status = 'OPEN'
WHERE ticket_status IS NULL
  AND category IN ('MAINTENANCE_STATUS','ETC_TASK_STATUS','SITE_VISIT','INSTALL_PLAN_STATUS')
  AND name = '접수';

-- 2) 처리중·답사예정 → IN_PROGRESS
UPDATE status_codes SET ticket_status = 'IN_PROGRESS'
WHERE ticket_status IS NULL
  AND ((category IN ('MAINTENANCE_STATUS','ETC_TASK_STATUS') AND name = '처리중')
    OR (category = 'SITE_VISIT' AND name = '답사예정'));

-- 3) 보류 → PENDING + 사유 '기타'
UPDATE status_codes SET
  ticket_status = 'PENDING',
  ticket_pending_reason_id = (SELECT id FROM ticket_pending_reasons WHERE name = '기타')
WHERE ticket_status IS NULL
  AND category IN ('MAINTENANCE_STATUS','ETC_TASK_STATUS','SITE_VISIT','INSTALL_PLAN_STATUS')
  AND name = '보류';

-- 4) 작성완료 → PENDING + 사유 '외부 회신 대기' (답사·설치계획)
UPDATE status_codes SET
  ticket_status = 'PENDING',
  ticket_pending_reason_id = (SELECT id FROM ticket_pending_reasons WHERE name = '외부 회신 대기')
WHERE ticket_status IS NULL
  AND category IN ('SITE_VISIT','INSTALL_PLAN_STATUS')
  AND name = '작성완료';

-- 5) 완료·회신완료 → CLOSED (결정①A — RESOLVED 건너뜀 현행 유지)
UPDATE status_codes SET ticket_status = 'CLOSED'
WHERE ticket_status IS NULL
  AND ((category IN ('MAINTENANCE_STATUS','ETC_TASK_STATUS') AND name = '완료')
    OR (category IN ('SITE_VISIT','INSTALL_PLAN_STATUS') AND name = '회신완료'));

-- 6) build_statuses (프로젝트) — 기존 라벨 앵커(포함 매칭)와 동일 의미로 명시화
UPDATE build_statuses SET ticket_status = 'CLOSED'      WHERE ticket_status IS NULL AND label LIKE '%완료%';
UPDATE build_statuses SET ticket_status = 'PENDING'     WHERE ticket_status IS NULL AND label LIKE '%보류%';
UPDATE build_statuses SET ticket_status = 'OPEN'        WHERE ticket_status IS NULL AND label LIKE '%준비%';
UPDATE build_statuses SET ticket_status = 'IN_PROGRESS' WHERE ticket_status IS NULL; -- 나머지 전부 (기존 default 분기와 동일)

-- 7) nav 메뉴 — 설치계획 상태 관리 (설정 > 업무 유형·상태 그룹, 유지보수 상태 관리 앞)
INSERT INTO nav_menu_items (menu_key, label, href, parent_key, group_label, allowed_roles, sort_order, is_active)
VALUES ('settings/install-plan-status', '설치계획 상태 관리', '/settings/install-plan-status', 'settings', '업무 유형·상태', '{SUPER_ADMIN,ADMIN}', 51, true)
ON CONFLICT (menu_key) DO NOTHING;

-- 확인
SELECT category, name, ticket_status, ticket_pending_reason_id
FROM status_codes
WHERE category IN ('MAINTENANCE_STATUS','ETC_TASK_STATUS','SITE_VISIT','INSTALL_PLAN_STATUS')
ORDER BY category, "order";
SELECT id, label, ticket_status FROM build_statuses ORDER BY sort_order;
