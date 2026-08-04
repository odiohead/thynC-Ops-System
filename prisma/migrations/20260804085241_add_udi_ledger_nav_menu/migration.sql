-- UDI 입출고대장 (projects/inventory_udi_ledger_design.md) P5
-- 설정 > 자재관리 그룹에 '입출고대장 문서' 메뉴 추가

INSERT INTO nav_menu_items (menu_key, label, href, icon_key, parent_key, group_label, allowed_roles, allowed_org_codes, is_active, sort_order, created_at, updated_at)
VALUES ('settings/udi-ledger', '입출고대장 문서', '/settings/udi-ledger', NULL, 'settings', '자재관리', '{SUPER_ADMIN,ADMIN}', '{}', true, 90, NOW(), NOW())
ON CONFLICT (menu_key) DO NOTHING;
