-- 주간업무 항목 첨부파일 (projects/weekly_attachments_design.md §4.1)
CREATE TABLE public.weekly_item_files (
  id            SERIAL PRIMARY KEY,
  item_id       INTEGER NOT NULL REFERENCES public.weekly_items(id) ON DELETE CASCADE,
  file_name     TEXT NOT NULL,
  s3_key        TEXT NOT NULL,
  size_bytes    INTEGER NOT NULL,
  content_type  TEXT,
  uploaded_by   TEXT REFERENCES public.users(id) ON DELETE SET NULL,
  uploaded_at   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX weekly_item_files_item_id_idx ON public.weekly_item_files(item_id);
