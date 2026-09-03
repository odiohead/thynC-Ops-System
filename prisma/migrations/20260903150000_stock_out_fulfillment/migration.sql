-- 출고업무 P2 — 출고 처리·WMS 연동 (stock_out_request_design.md §13, 2026-09-03)
-- ① 전표↔출고요청 링크 ② 품목 WMS 매핑 키 ③ 과도기 시리얼 기록 ④ 처리 스탬프

ALTER TABLE inventory_transactions ADD COLUMN stock_out_request_id INTEGER;
ALTER TABLE inventory_transactions ADD CONSTRAINT inventory_transactions_stock_out_request_id_fkey
  FOREIGN KEY (stock_out_request_id) REFERENCES stock_out_requests(id) ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX inventory_transactions_stock_out_request_id_idx ON inventory_transactions(stock_out_request_id);

ALTER TABLE stock_out_items ADD COLUMN wms_model_name TEXT;

ALTER TABLE stock_out_request_items ADD COLUMN fulfilled_serials TEXT;

ALTER TABLE stock_out_requests ADD COLUMN fulfilled_at TIMESTAMP(3);
ALTER TABLE stock_out_requests ADD COLUMN fulfilled_by_id TEXT;
ALTER TABLE stock_out_requests ADD CONSTRAINT stock_out_requests_fulfilled_by_id_fkey
  FOREIGN KEY (fulfilled_by_id) REFERENCES users(id) ON DELETE SET NULL ON UPDATE CASCADE;
