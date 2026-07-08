-- 1) 이관(TRANSFER) 일자·단가 — 대웅제약재고→판매용재고 이관은 재판매 개념 (단가는 참고용)
ALTER TABLE inventory_transactions ADD COLUMN transfer_date DATE;
ALTER TABLE inventory_transactions ADD COLUMN transfer_price INT;

-- 2) 설정 메뉴 그룹화 — 기능별 그룹 라벨 (NULL=미분류, 네비게이션에서 그룹 헤더로 표시)
ALTER TABLE nav_menu_items ADD COLUMN group_label VARCHAR(50);

UPDATE nav_menu_items SET group_label = '일반',          sort_order = 10  WHERE menu_key = 'settings/profile';
UPDATE nav_menu_items SET group_label = '일반',          sort_order = 15  WHERE menu_key = 'settings/nav-menus';
UPDATE nav_menu_items SET group_label = '조직·계정',     sort_order = 20  WHERE menu_key = 'settings/organizations';
UPDATE nav_menu_items SET group_label = '조직·계정',     sort_order = 25  WHERE menu_key = 'settings/field-engineers';
UPDATE nav_menu_items SET group_label = '병원·구축',     sort_order = 30  WHERE menu_key = 'settings/status';
UPDATE nav_menu_items SET group_label = '병원·구축',     sort_order = 32  WHERE menu_key = 'settings/intro-type';
UPDATE nav_menu_items SET group_label = '병원·구축',     sort_order = 34  WHERE menu_key = 'settings/build-status';
UPDATE nav_menu_items SET group_label = '병원·구축',     sort_order = 36  WHERE menu_key = 'settings/constructors';
UPDATE nav_menu_items SET group_label = '병원·구축',     sort_order = 38  WHERE menu_key = 'settings/devices';
UPDATE nav_menu_items SET group_label = '병원·구축',     sort_order = 40  WHERE menu_key = 'settings/site-visit-status';
UPDATE nav_menu_items SET group_label = '업무 유형·상태', sort_order = 50  WHERE menu_key = 'settings/maintenance-type';
UPDATE nav_menu_items SET group_label = '업무 유형·상태', sort_order = 52  WHERE menu_key = 'settings/maintenance-status';
UPDATE nav_menu_items SET group_label = '업무 유형·상태', sort_order = 54  WHERE menu_key = 'settings/etc-task-status';
UPDATE nav_menu_items SET group_label = '업무 유형·상태', sort_order = 56  WHERE menu_key = 'settings/consultation-type';
UPDATE nav_menu_items SET group_label = '업무 유형·상태', sort_order = 58  WHERE menu_key = 'settings/document-type';
UPDATE nav_menu_items SET group_label = '자재관리',       sort_order = 70  WHERE menu_key = 'settings/inventories';
UPDATE nav_menu_items SET group_label = '자재관리',       sort_order = 72  WHERE menu_key = 'settings/warehouses';
UPDATE nav_menu_items SET group_label = '자재관리',       sort_order = 74  WHERE menu_key = 'settings/item-category';
UPDATE nav_menu_items SET group_label = '자재관리',       sort_order = 76  WHERE menu_key = 'settings/manufacturers';
UPDATE nav_menu_items SET group_label = '자재관리',       sort_order = 78  WHERE menu_key = 'settings/stock-reasons';
UPDATE nav_menu_items SET group_label = '자재관리',       sort_order = 80  WHERE menu_key = 'settings/inventory-managers';
UPDATE nav_menu_items SET group_label = '차량',           sort_order = 90  WHERE menu_key = 'settings/vehicles';
UPDATE nav_menu_items SET group_label = '연동·알림',      sort_order = 100 WHERE menu_key = 'settings/hira-sync';
UPDATE nav_menu_items SET group_label = '연동·알림',      sort_order = 102 WHERE menu_key = 'settings/mail-sync';
UPDATE nav_menu_items SET group_label = '연동·알림',      sort_order = 104 WHERE menu_key = 'settings/notifications';
