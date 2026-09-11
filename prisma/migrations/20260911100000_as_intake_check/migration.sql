-- AS 입고 대조 (2026-09-11 — as_work_design.md §14): 라인 입고상태·라인 입고일·치환 전 원 시리얼·편입 출처, 헤더 확인일(O열), 결과 '미회수' 추가
ALTER TABLE as_receipts ADD COLUMN checked_at DATE;
ALTER TABLE as_receipt_items
  ADD COLUMN intake_state TEXT NOT NULL DEFAULT 'PENDING',
  ADD COLUMN received_at DATE,
  ADD COLUMN receipt_serial_no TEXT,
  ADD COLUMN intake_source TEXT NOT NULL DEFAULT 'RECEIPT';
ALTER TABLE as_receipt_items ADD CONSTRAINT as_receipt_items_intake_state_check
  CHECK (intake_state IN ('PENDING','RECEIVED','MISMATCH','EXTRA'));
ALTER TABLE as_receipt_items ADD CONSTRAINT as_receipt_items_intake_source_check
  CHECK (intake_source IN ('RECEIPT','INTAKE'));
ALTER TABLE as_receipt_items DROP CONSTRAINT as_receipt_items_outcome_check;
ALTER TABLE as_receipt_items ADD CONSTRAINT as_receipt_items_outcome_check
  CHECK (outcome IS NULL OR outcome IN ('REPAIR_RETURN','REPLACE','LOST','CANCELED','NOT_RECEIVED'));
CREATE INDEX as_receipt_items_intake_state_idx ON as_receipt_items (intake_state) WHERE intake_state IN ('MISMATCH','EXTRA');
