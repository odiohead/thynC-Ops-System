-- AS접수 라인 처리방법 초안 (2026-09-14) — 최종확정 전까지 변경 가능. 확정 시 outcome으로 이관·초안 비움
ALTER TABLE as_receipt_items
  ADD COLUMN IF NOT EXISTS draft_outcome VARCHAR(20),
  ADD COLUMN IF NOT EXISTS draft_new_serial_no VARCHAR(50);
ALTER TABLE as_receipt_items DROP CONSTRAINT IF EXISTS as_receipt_items_draft_outcome_check;
ALTER TABLE as_receipt_items ADD CONSTRAINT as_receipt_items_draft_outcome_check
  CHECK (draft_outcome IS NULL OR draft_outcome IN ('REPAIR_RETURN','REPLACE','LOST','CANCELED'));
