-- AS접수 분할 (projects/as_receipt_split_design.md §4.1) — 자식 접수가 원본을 가리키는 자기참조 1컬럼
ALTER TABLE as_receipts ADD COLUMN IF NOT EXISTS split_from_id INTEGER
  REFERENCES as_receipts(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS as_receipts_split_from_idx ON as_receipts(split_from_id);
