-- 네비게이션 개편 (2026-08-16 사용자 요청) — '운영현황' 1depth 신설 + 운영 메뉴 10종 2depth 이동
-- idempotent: PROD 반영·재실행 안전
--   psql -U thync -d thync_ops_dev -f scripts/nav-reorg-20260816.sql
--
-- 최종 1depth: AI 어시스턴트 / 티켓 / 사내 위키 / 영업 현황 / 운영현황(아코디언) / 설정 / 계정 관리
-- 운영현황 하위: 병원 목록, 설치계획(가안) 관리, 답사 관리, 프로젝트 관리, VOC 접수(사용자 목록 미기재 — 운영 업무라 유지보수 앞 배치),
--               유지보수, 기타업무, 자재관리, 구축일정 간트차트, 차량예약, 심평원 병원목록
-- ※ href '/operations'는 라우트 없음 — 아코디언 토글 전용 (Navigation이 하위 보유 시 버튼으로 렌더)

-- 1) '운영현황' 부모 신설
INSERT INTO nav_menu_items (menu_key, label, href, icon_key, sort_order)
VALUES ('operations', '운영현황', '/operations', 'clipboard-list', 18)
ON CONFLICT (menu_key) DO NOTHING;

-- 2) 1depth 순서 (설정 70·계정 관리 80은 유지)
UPDATE nav_menu_items SET sort_order = 10 WHERE menu_key = 'ai-assistant';
UPDATE nav_menu_items SET sort_order = 12 WHERE menu_key = 'tickets';
UPDATE nav_menu_items SET sort_order = 14 WHERE menu_key = 'wiki';
UPDATE nav_menu_items SET sort_order = 16 WHERE menu_key = 'sales';
UPDATE nav_menu_items SET sort_order = 18 WHERE menu_key = 'operations';

-- 3) 운영 메뉴 → 운영현황 하위로 이동 (요청 순서대로)
UPDATE nav_menu_items SET parent_key = 'operations', sort_order = 10  WHERE menu_key = 'hospitals';
UPDATE nav_menu_items SET parent_key = 'operations', sort_order = 20  WHERE menu_key = 'install-plans';
UPDATE nav_menu_items SET parent_key = 'operations', sort_order = 30  WHERE menu_key = 'site-visits';
UPDATE nav_menu_items SET parent_key = 'operations', sort_order = 40  WHERE menu_key = 'projects';
UPDATE nav_menu_items SET parent_key = 'operations', sort_order = 45  WHERE menu_key = 'voc';
UPDATE nav_menu_items SET parent_key = 'operations', sort_order = 50  WHERE menu_key = 'maintenances';
UPDATE nav_menu_items SET parent_key = 'operations', sort_order = 60  WHERE menu_key = 'etc-tasks';
UPDATE nav_menu_items SET parent_key = 'operations', sort_order = 70  WHERE menu_key = 'inventory';
UPDATE nav_menu_items SET parent_key = 'operations', sort_order = 80  WHERE menu_key = 'gantt-chart';
UPDATE nav_menu_items SET parent_key = 'operations', sort_order = 90  WHERE menu_key = 'vehicle-reservations';
UPDATE nav_menu_items SET parent_key = 'operations', sort_order = 100 WHERE menu_key = 'hira-hospitals';

-- 확인
SELECT menu_key, label, sort_order FROM nav_menu_items WHERE parent_key IS NULL AND is_active ORDER BY sort_order;
SELECT menu_key, label, sort_order FROM nav_menu_items WHERE parent_key = 'operations' ORDER BY sort_order;
