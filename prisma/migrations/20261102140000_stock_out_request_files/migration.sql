-- 출고요청 첨부파일 (projects/stock_out_v2_design.md §15, 2026-11-02) — 엑셀 등 요청 근거 파일. 분류 없음, N건
CREATE TABLE public.stock_out_request_files (
  id            SERIAL PRIMARY KEY,
  request_id    INTEGER NOT NULL REFERENCES public.stock_out_requests(id) ON DELETE CASCADE,
  file_name     TEXT NOT NULL,
  s3_key        TEXT NOT NULL,
  size_bytes    INTEGER NOT NULL,
  content_type  TEXT,
  uploaded_by   TEXT REFERENCES public.users(id) ON DELETE SET NULL,
  uploaded_at   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX stock_out_request_files_request_id_idx ON public.stock_out_request_files(request_id);
