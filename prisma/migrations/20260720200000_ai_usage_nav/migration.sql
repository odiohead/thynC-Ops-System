-- AI 어시스턴트 사용 현황 관리 페이지 — 설정 하위 메뉴 (ADMIN 이상)
INSERT INTO nav_menu_items (menu_key, label, href, icon_key, parent_key, allowed_roles, allowed_org_codes, is_active, sort_order, group_label, updated_at)
VALUES ('settings/ai-usage', 'AI 사용 현황', '/settings/ai-usage', NULL, 'settings', '{SUPER_ADMIN,ADMIN}', '{}', true, 106, '연동·알림', CURRENT_TIMESTAMP)
ON CONFLICT (menu_key) DO NOTHING;
