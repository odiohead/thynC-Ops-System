-- 품목 마스터에 모델명 추가 (제조사 모델 식별자 — 규격(spec)과 별개)
ALTER TABLE inventory_items ADD COLUMN model_name VARCHAR(100);
