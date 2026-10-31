-- VOC·AS 주간 대시보드 — 주간 보고 PDF 첨부 (주당 1건, 1페이지 PDF → PNG 변환본 표시)
CREATE TABLE IF NOT EXISTS voc_dashboard_reports (
  id              SERIAL PRIMARY KEY,
  week_start      DATE NOT NULL UNIQUE,                 -- 금~목 주의 금요일(KST 달력 날짜) — lib/vocDashboard parseWeekStart
  file_name       VARCHAR(255) NOT NULL,                -- 업로드 원본 파일명
  pdf_key         TEXT NOT NULL,                        -- S3 원본 PDF
  image_key       TEXT NOT NULL,                        -- S3 변환 PNG(1페이지, 200DPI)
  image_width     INTEGER NOT NULL,
  image_height    INTEGER NOT NULL,
  pdf_size        INTEGER NOT NULL,
  uploaded_by_id  TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
