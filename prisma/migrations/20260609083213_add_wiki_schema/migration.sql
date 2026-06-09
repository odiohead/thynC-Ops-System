-- 사내 위키(Wiki) 모듈 — 스키마 신설 + 초기 테이블 (Phase 1)
-- 격리: wiki.* 스키마. FK 방향은 wiki → public 만 허용.

CREATE SCHEMA IF NOT EXISTS wiki;

-- ────────────────────────────────────────────────────────────
-- wiki.wiki_pages — 위키 페이지 (트리 구조, BlockNote JSON 본문)
-- ────────────────────────────────────────────────────────────
CREATE TABLE wiki.wiki_pages (
  id               TEXT PRIMARY KEY,
  parent_id        TEXT,
  title            TEXT NOT NULL,
  slug             TEXT,
  content_json     JSONB NOT NULL,
  is_published     BOOLEAN NOT NULL DEFAULT true,
  sort_order       INTEGER NOT NULL DEFAULT 0,
  author_id        TEXT NOT NULL,
  last_editor_id   TEXT,
  created_at       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       TIMESTAMP(3) NOT NULL,

  CONSTRAINT wiki_pages_parent_fkey
    FOREIGN KEY (parent_id) REFERENCES wiki.wiki_pages(id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT wiki_pages_author_fkey
    FOREIGN KEY (author_id) REFERENCES public.users(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT wiki_pages_last_editor_fkey
    FOREIGN KEY (last_editor_id) REFERENCES public.users(id) ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX wiki_pages_parent_id_sort_order_idx
  ON wiki.wiki_pages(parent_id, sort_order);

CREATE INDEX wiki_pages_updated_at_idx
  ON wiki.wiki_pages(updated_at DESC);

CREATE INDEX wiki_pages_author_id_idx
  ON wiki.wiki_pages(author_id);

-- ────────────────────────────────────────────────────────────
-- wiki.wiki_attachments — 페이지 첨부 파일 (S3 메타)
-- ────────────────────────────────────────────────────────────
CREATE TABLE wiki.wiki_attachments (
  id           TEXT PRIMARY KEY,
  page_id      TEXT NOT NULL,
  file_name    TEXT NOT NULL,
  s3_key       TEXT NOT NULL,
  size         INTEGER NOT NULL,
  mime_type    TEXT NOT NULL,
  uploader_id  TEXT NOT NULL,
  created_at   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT wiki_attachments_page_fkey
    FOREIGN KEY (page_id) REFERENCES wiki.wiki_pages(id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT wiki_attachments_uploader_fkey
    FOREIGN KEY (uploader_id) REFERENCES public.users(id) ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX wiki_attachments_s3_key_key
  ON wiki.wiki_attachments(s3_key);

CREATE INDEX wiki_attachments_page_id_idx
  ON wiki.wiki_attachments(page_id);
