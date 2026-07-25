-- AI 어시스턴트 설정 화면 네비게이션 메뉴 (재실행 안전)
-- 설정 > 연동·알림 그룹, 'AI 사용 현황'(106) 바로 뒤에 배치
--
-- DEV:  psql -U thync -d thync_ops_dev -f scripts/seed-ai-assistant-nav.sql
-- PROD: 사용자 명시 허락 후 psql -U thync -d thync_ops -f scripts/seed-ai-assistant-nav.sql

INSERT INTO nav_menu_items (menu_key, label, href, parent_key, allowed_roles, group_label, sort_order, is_active)
VALUES ('settings/ai-assistant', 'AI 어시스턴트 설정', '/settings/ai-assistant', 'settings',
        '{SUPER_ADMIN,ADMIN}', '연동·알림', 107, true)
ON CONFLICT (menu_key) DO UPDATE
   SET label         = EXCLUDED.label,
       href          = EXCLUDED.href,
       parent_key    = EXCLUDED.parent_key,
       allowed_roles = EXCLUDED.allowed_roles,
       group_label   = EXCLUDED.group_label,
       sort_order    = EXCLUDED.sort_order,
       updated_at    = CURRENT_TIMESTAMP;

-- v3: 어시스턴트를 자사(SEERS) 전용으로 스코핑 (2026-07-25 확정)
-- 서버 강제는 lib/ai/access.ts가 담당하고, 이것은 메뉴 노출 정리용이다.
UPDATE nav_menu_items
   SET allowed_org_codes = '{SEERS}', updated_at = CURRENT_TIMESTAMP
 WHERE menu_key IN ('ai-assistant', 'settings/ai-assistant', 'settings/ai-usage')
   AND allowed_org_codes <> '{SEERS}';
