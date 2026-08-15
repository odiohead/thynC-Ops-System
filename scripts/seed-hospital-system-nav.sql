-- thynC 시스템 현황 보강 (2026-08-16) — 설정 > EMR 업체 관리 nav
-- idempotent: PROD 반영·재실행 안전
--   psql -U thync -d thync_ops_dev -f scripts/seed-hospital-system-nav.sql

INSERT INTO nav_menu_items (menu_key, label, href, parent_key, sort_order, group_label, allowed_roles) VALUES
  ('settings/emr-vendor', 'EMR 업체 관리', '/settings/emr-vendor', 'settings', 39, '병원·구축', '{SUPER_ADMIN,ADMIN}')
ON CONFLICT (menu_key) DO NOTHING;

SELECT menu_key, label, group_label, sort_order FROM nav_menu_items WHERE menu_key = 'settings/emr-vendor';
