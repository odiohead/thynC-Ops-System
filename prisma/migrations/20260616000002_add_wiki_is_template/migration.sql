-- 페이지를 템플릿으로 표시 (Phase 12 / B3)
ALTER TABLE wiki.wiki_pages ADD COLUMN IF NOT EXISTS is_template BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS wiki_pages_is_template_idx ON wiki.wiki_pages (is_template);
