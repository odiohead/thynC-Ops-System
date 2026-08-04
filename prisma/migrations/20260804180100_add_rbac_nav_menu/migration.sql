-- RBAC Lite (projects/rbac_design.md §7) — 설정 > 조직·계정 그룹에 '역할 관리' 메뉴 추가 (SUPER_ADMIN 전용)

INSERT INTO nav_menu_items (menu_key, label, href, icon_key, parent_key, group_label, allowed_roles, allowed_org_codes, is_active, sort_order, created_at, updated_at)
VALUES ('settings/roles', '역할 관리', '/settings/roles', NULL, 'settings', '조직·계정', '{SUPER_ADMIN}', '{}', true, 22, NOW(), NOW())
ON CONFLICT (menu_key) DO NOTHING;
