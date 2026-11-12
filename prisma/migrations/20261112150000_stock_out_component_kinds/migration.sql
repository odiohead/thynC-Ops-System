-- 출고요청 시스템 구성품 — 고정 종류(kinds) + 요청 단위 구성품·미출고 (2026-11-12)
-- 1) 구성품 종류: 대웅제약재고에 복제한 구성품 품목(item_id) ↔ thynC운영팀재고 원본(source_item_id — 미출고분 편입 대상)
CREATE TABLE public.stock_out_component_kinds (
  item_id        INTEGER PRIMARY KEY,
  source_item_id INTEGER NOT NULL,
  sort_order     INTEGER NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT stock_out_component_kinds_item_id_fkey FOREIGN KEY (item_id) REFERENCES public.inventory_items(id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT stock_out_component_kinds_source_item_id_fkey FOREIGN KEY (source_item_id) REFERENCES public.inventory_items(id) ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX stock_out_component_kinds_source_item_id_key ON public.stock_out_component_kinds (source_item_id);

-- 2) 구성 수량은 0 허용 — 시스템 × 구성품 종류 행을 전부 유지하고 수량만 조정(0 = 미포함)
ALTER TABLE public.stock_out_item_components DROP CONSTRAINT IF EXISTS stock_out_item_components_quantity_check;
ALTER TABLE public.stock_out_item_components ADD CONSTRAINT stock_out_item_components_quantity_check CHECK (quantity >= 0);

-- 3) 요청 단위 구성품: 저장 시점의 구성품별 합계 수량(시스템 수량 × 구성 수량의 합) + 신청자 미출고 수량 + 출고 처리 기록
CREATE TABLE public.stock_out_request_components (
  id                 SERIAL PRIMARY KEY,
  request_id         INTEGER NOT NULL,
  item_id            INTEGER NOT NULL,
  quantity           INTEGER NOT NULL,
  unshipped_quantity INTEGER NOT NULL DEFAULT 0,
  shipped_serials    TEXT,
  unshipped_serials  TEXT,
  sort_order         INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT stock_out_request_components_request_id_fkey FOREIGN KEY (request_id) REFERENCES public.stock_out_requests(id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT stock_out_request_components_item_id_fkey FOREIGN KEY (item_id) REFERENCES public.inventory_items(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT stock_out_request_components_qty_chk CHECK (quantity > 0),
  CONSTRAINT stock_out_request_components_unshipped_chk CHECK (unshipped_quantity >= 0 AND unshipped_quantity <= quantity)
);
CREATE UNIQUE INDEX stock_out_request_components_request_id_item_id_key ON public.stock_out_request_components (request_id, item_id);
CREATE INDEX stock_out_request_components_item_id_idx ON public.stock_out_request_components (item_id);
