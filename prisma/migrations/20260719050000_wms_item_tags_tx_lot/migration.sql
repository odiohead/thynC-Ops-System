-- 품목 태그 + 전표 단위 LOT (비시리얼 LOT 관리 품목용)
ALTER TABLE public.inventory_items ADD COLUMN tags TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE public.inventory_transactions ADD COLUMN lot_no VARCHAR(100);
