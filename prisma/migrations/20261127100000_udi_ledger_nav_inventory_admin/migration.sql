-- 입출고대장 문서 설정 메뉴를 자재 관리자(역할 '재고책임자' — inventory.admin)에게도 노출 (2026-11-27)
-- 다른 자재관리 설정 메뉴(인벤토리·창고·품목 분류·재고 담당자)와 같이 USER까지 노출하고,
-- 실제 접근은 페이지·API의 canAdminInventory(ADMIN 또는 USER 이상 + inventory.admin)가 판정한다.
UPDATE nav_menu_items
SET allowed_roles = '{SUPER_ADMIN,ADMIN,USER}', updated_at = NOW()
WHERE menu_key = 'settings/udi-ledger';
