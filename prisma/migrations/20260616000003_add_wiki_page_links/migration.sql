-- 위키 페이지 간 링크 인덱스 (백링크용, Phase 12 / B2)
CREATE TABLE IF NOT EXISTS wiki.wiki_page_links (
  source_page_id TEXT NOT NULL REFERENCES wiki.wiki_pages(id) ON DELETE CASCADE,
  target_page_id TEXT NOT NULL REFERENCES wiki.wiki_pages(id) ON DELETE CASCADE,
  PRIMARY KEY (source_page_id, target_page_id)
);
CREATE INDEX IF NOT EXISTS wiki_page_links_target_idx ON wiki.wiki_page_links (target_page_id);
