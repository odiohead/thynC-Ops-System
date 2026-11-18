-- 사용량 화면(/usage) 네비게이션 메뉴 등록 — 멱등 (projects/usage_collection_design.md §14)
--   psql "$DATABASE_URL" -f scripts/seed-usage-nav.sql
-- 운영현황 아래, 기기 현황 다음. 메뉴 노출은 SEERS 소속 ADMIN 이상 — 실제 접근은 lib/usage/access.ts 가 판정한다
-- (usage.view 권한만 가진 사용자는 메뉴 없이 병원 상세의 '사용량 보기' 링크나 주소로 들어온다).
-- PROD → 개발 환경 데이터 동기화 후에는 PROD에 이 행이 생기기 전까지 다시 실행해야 한다.
INSERT INTO nav_menu_items (menu_key, label, href, icon_key, parent_key, allowed_roles, allowed_org_codes, sort_order, is_active)
VALUES ('usage', '사용량', '/usage', 'activity', 'operations', ARRAY['SUPER_ADMIN', 'ADMIN'], ARRAY['SEERS'], 57, true)
ON CONFLICT (menu_key) DO NOTHING;
