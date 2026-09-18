-- 수거방법 '수거없음'(NONE) 추가 (2026-09-18) — 분실 접수 등록 시 기본값. 발송방법(as_receipt_items.ship_method) CHECK는 불변
ALTER TABLE as_receipts DROP CONSTRAINT IF EXISTS as_receipts_pickup_method_check;
ALTER TABLE as_receipts ADD CONSTRAINT as_receipts_pickup_method_check CHECK (pickup_method IS NULL OR pickup_method IN ('PARCEL','VISIT','NONE'));
