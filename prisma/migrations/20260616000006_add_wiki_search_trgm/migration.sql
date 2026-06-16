-- 위키 검색(ILIKE) 가속용 trigram GIN 인덱스 (Phase 13 / B5)
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS wiki_pages_title_trgm ON wiki.wiki_pages USING gin (title gin_trgm_ops);
CREATE INDEX IF NOT EXISTS wiki_pages_plaintext_trgm ON wiki.wiki_pages USING gin (plain_text gin_trgm_ops);
