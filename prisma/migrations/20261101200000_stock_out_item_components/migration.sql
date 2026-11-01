-- 출고요청 — 품목 구성 안내 (projects/stock_out_v2_design.md §13, 2026-11-01)
-- 대웅제약재고 'thynC 시스템 XX' 1개에 포함되는 thynC운영팀재고 부자재 수량. 인벤토리가 달라 WMS 주자재-부자재 매핑(같은 인벤토리 한정)을 쓸 수 없음.
-- 재고 관리와 무관한 안내 전용(출고요청 팝업에서 '포함 n' 표시).
CREATE TABLE IF NOT EXISTS stock_out_item_components (
  parent_item_id INTEGER NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
  child_item_id  INTEGER NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
  quantity       INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),   -- 주 품목 1개당 포함 수량
  sort_order     INTEGER NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (parent_item_id, child_item_id)
);
CREATE INDEX IF NOT EXISTS stock_out_item_components_child_idx ON stock_out_item_components (child_item_id);
