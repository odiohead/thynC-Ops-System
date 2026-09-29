-- 병원 AS메모 (2026-09-29) — 병원 상세 '부가정보 > AS메모' + AS접수 상세 1.공통정보에서 공용 편집. 리치텍스트(HTML, Tiptap — 색·형광펜, sanitize 후 저장)
ALTER TABLE hospital_meta ADD COLUMN IF NOT EXISTS as_memo TEXT;
ALTER TABLE hospital_meta ADD COLUMN IF NOT EXISTS as_memo_updated_at TIMESTAMPTZ;
ALTER TABLE hospital_meta ADD COLUMN IF NOT EXISTS as_memo_updated_by_id TEXT REFERENCES users(id) ON DELETE SET NULL;
