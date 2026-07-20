-- 자재관리 A안 — 재고 스냅샷에 LOT 차원 추가 (2026-07-20)
-- 비시리얼 LOT 관리 품목의 재고를 (품목×위치×LOT) 버킷으로 관리.
-- 기존 재고·시리얼 품목·비LOT 품목은 lot_no='' ("LOT 없음") 버킷.
ALTER TABLE inventory_stocks ADD COLUMN lot_no VARCHAR(100) NOT NULL DEFAULT '';
ALTER TABLE inventory_stocks DROP CONSTRAINT inventory_stocks_pkey;
ALTER TABLE inventory_stocks ADD CONSTRAINT inventory_stocks_pkey PRIMARY KEY (item_id, warehouse_id, inventory_id, lot_no);
