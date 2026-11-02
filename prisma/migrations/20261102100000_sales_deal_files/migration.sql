-- 딜(계약 이력) 첨부 — 견적서·계약서 (projects/sales_crm_design.md §7, 2026-11-02)
-- kind: QUOTE(견적서) | CONTRACT(계약서). 종류별 N건 허용, 필수 아님(계약서는 추후 전달 가능)
CREATE TABLE public.sales_deal_files (
  id            SERIAL PRIMARY KEY,
  deal_id       INTEGER NOT NULL REFERENCES public.sales_deals(id) ON DELETE CASCADE,
  kind          VARCHAR(20) NOT NULL CHECK (kind IN ('QUOTE', 'CONTRACT')),
  file_name     TEXT NOT NULL,
  s3_key        TEXT NOT NULL,
  size_bytes    INTEGER NOT NULL,
  content_type  TEXT,
  uploaded_by   TEXT REFERENCES public.users(id) ON DELETE SET NULL,
  uploaded_at   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX sales_deal_files_deal_id_idx ON public.sales_deal_files(deal_id);
