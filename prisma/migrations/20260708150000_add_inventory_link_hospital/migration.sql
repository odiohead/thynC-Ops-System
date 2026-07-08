-- 병원 연결 허용 인벤토리 플래그 (Phase 9 보완)
-- 출고 시 병원 연결은 link_hospital=true 인벤토리(대웅제약재고)에서만 가능
ALTER TABLE inventories ADD COLUMN link_hospital BOOLEAN NOT NULL DEFAULT false;
UPDATE inventories SET link_hospital = true WHERE name = '대웅제약재고';
