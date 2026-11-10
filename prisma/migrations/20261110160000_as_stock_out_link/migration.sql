-- 분실 AS ↔ 출고업무 연동 (2026-11-10 — projects/as_lost_stock_out_link_design.md §3)
ALTER TABLE stock_out_requests ADD COLUMN IF NOT EXISTS as_receipt_id INTEGER REFERENCES as_receipts(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS stock_out_requests_as_receipt_idx ON stock_out_requests(as_receipt_id);
ALTER TABLE as_receipt_items ADD COLUMN IF NOT EXISTS stock_out_request_id INTEGER REFERENCES stock_out_requests(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS as_receipt_items_stock_out_request_idx ON as_receipt_items(stock_out_request_id);
