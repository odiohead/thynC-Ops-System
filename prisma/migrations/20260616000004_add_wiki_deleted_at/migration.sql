-- 위키 페이지 휴지통(soft delete) (Phase 13 / B4)
ALTER TABLE wiki.wiki_pages ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS wiki_pages_deleted_at_idx ON wiki.wiki_pages (deleted_at);
