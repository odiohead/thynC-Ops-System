-- 위키 청크 인덱스 (v3 W1)
-- 검색·반환 단위를 문서에서 헤딩 청크로 내린다.
-- 68,772자 문서에서 6,000자씩 선형으로 읽던 것을 관련 청크 2~3개 직접 반환으로 대체.
CREATE TABLE wiki.wiki_chunks (
  id           SERIAL PRIMARY KEY,
  page_id      TEXT NOT NULL REFERENCES wiki.wiki_pages(id) ON DELETE CASCADE,
  ordinal      INTEGER NOT NULL,
  heading_path TEXT NOT NULL DEFAULT '',
  text         TEXT NOT NULL,
  char_start   INTEGER NOT NULL DEFAULT 0,
  char_end     INTEGER NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX wiki_chunks_page_ordinal_key ON wiki.wiki_chunks (page_id, ordinal);
CREATE INDEX wiki_chunks_page_id_idx ON wiki.wiki_chunks (page_id);
CREATE INDEX wiki_chunks_text_trgm_idx ON wiki.wiki_chunks USING gin (text gin_trgm_ops);
CREATE INDEX wiki_chunks_heading_trgm_idx ON wiki.wiki_chunks USING gin (heading_path gin_trgm_ops);
