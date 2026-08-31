-- 딜 상품유형 (일반/라이트) — 기존 레코드는 전부 '일반'으로 백필
ALTER TABLE sales_deals ADD COLUMN product_type TEXT NOT NULL DEFAULT '일반';
