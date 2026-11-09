-- 레포트 메뉴 (projects/hospital_report_design.md §10) — 메인 네비 '레포트', 최고관리자 전용. 멱등
-- 서버 강제는 /reports·/api/reports/* 의 isSuperAdmin (nav는 노출 제어일 뿐)
INSERT INTO nav_menu_items (menu_key, label, href, icon_key, parent_key, sort_order, allowed_roles) VALUES
  ('reports', '레포트', '/reports', 'file-text', NULL, 65, '{SUPER_ADMIN}')
ON CONFLICT (menu_key) DO NOTHING;

-- 확인
SELECT menu_key, label, href, icon_key, parent_key, sort_order, allowed_roles, is_active FROM nav_menu_items WHERE menu_key = 'reports';
