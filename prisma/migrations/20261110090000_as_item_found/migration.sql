-- 분실기기 되찾음 (2026-11-10 — projects/as_lost_found_design.md §3.2)
-- 분실 접수의 교체 확정 라인을 '되찾음(FOUND)'으로: 교체 이력(new_serial_no 등)은 보존, 되찾은 날·처리자·교체기기 회수 송장·회수 입고일 추가
ALTER TABLE as_receipt_items DROP CONSTRAINT IF EXISTS as_receipt_items_outcome_check;
ALTER TABLE as_receipt_items ADD CONSTRAINT as_receipt_items_outcome_check
  CHECK (outcome IS NULL OR outcome IN ('REPAIR_RETURN','REPLACE','LOST','CANCELED','NOT_RECEIVED','FOUND'));
ALTER TABLE as_receipt_items ADD COLUMN IF NOT EXISTS found_at DATE;
ALTER TABLE as_receipt_items ADD COLUMN IF NOT EXISTS found_by_id TEXT REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE as_receipt_items ADD COLUMN IF NOT EXISTS recall_tracking_no VARCHAR(50);
ALTER TABLE as_receipt_items ADD COLUMN IF NOT EXISTS recall_received_at DATE;
ALTER TABLE as_receipt_items DROP CONSTRAINT IF EXISTS as_receipt_items_found_check;
ALTER TABLE as_receipt_items ADD CONSTRAINT as_receipt_items_found_check CHECK ((outcome = 'FOUND') = (found_at IS NOT NULL));
