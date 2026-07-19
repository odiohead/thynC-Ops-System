-- 자재관리 보완: 전표 요청자 + 품목 LOT 관리 플래그 + 개체 LOT 번호
ALTER TABLE public.inventory_transactions ADD COLUMN requester VARCHAR(100);
ALTER TABLE public.inventory_items ADD COLUMN is_lot_managed BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE public.inventory_units ADD COLUMN lot_no VARCHAR(100);
