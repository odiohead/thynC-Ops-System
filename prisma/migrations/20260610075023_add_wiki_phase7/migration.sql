-- 사내 위키 Phase 7 — 태그/즐겨찾기/최근 본/버전/댓글 + 검색용 plain_text

-- ──────────────────────────────────────────────────────────
-- wiki.wiki_pages 에 검색용 plain_text 컬럼 추가
-- ──────────────────────────────────────────────────────────
ALTER TABLE wiki.wiki_pages
  ADD COLUMN plain_text TEXT NOT NULL DEFAULT '';

-- ──────────────────────────────────────────────────────────
-- 태그
-- ──────────────────────────────────────────────────────────
CREATE TABLE wiki.wiki_tags (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  color       TEXT,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX wiki_tags_name_key ON wiki.wiki_tags(name);

CREATE TABLE wiki.wiki_page_tags (
  page_id   TEXT NOT NULL,
  tag_id    TEXT NOT NULL,
  added_at  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (page_id, tag_id),
  CONSTRAINT wiki_page_tags_page_fkey
    FOREIGN KEY (page_id) REFERENCES wiki.wiki_pages(id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT wiki_page_tags_tag_fkey
    FOREIGN KEY (tag_id) REFERENCES wiki.wiki_tags(id) ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX wiki_page_tags_tag_id_idx ON wiki.wiki_page_tags(tag_id);

-- ──────────────────────────────────────────────────────────
-- 즐겨찾기
-- ──────────────────────────────────────────────────────────
CREATE TABLE wiki.wiki_favorites (
  user_id     TEXT NOT NULL,
  page_id     TEXT NOT NULL,
  created_at  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, page_id),
  CONSTRAINT wiki_favorites_user_fkey
    FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT wiki_favorites_page_fkey
    FOREIGN KEY (page_id) REFERENCES wiki.wiki_pages(id) ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX wiki_favorites_user_created_idx ON wiki.wiki_favorites(user_id, created_at DESC);

-- ──────────────────────────────────────────────────────────
-- 최근 본 페이지 (사용자별 열람 로그)
-- ──────────────────────────────────────────────────────────
CREATE TABLE wiki.wiki_view_logs (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL,
  page_id    TEXT NOT NULL,
  viewed_at  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT wiki_view_logs_user_fkey
    FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT wiki_view_logs_page_fkey
    FOREIGN KEY (page_id) REFERENCES wiki.wiki_pages(id) ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX wiki_view_logs_user_viewed_idx ON wiki.wiki_view_logs(user_id, viewed_at DESC);
CREATE INDEX wiki_view_logs_page_id_idx ON wiki.wiki_view_logs(page_id);

-- ──────────────────────────────────────────────────────────
-- 버전 히스토리 (수정 시 스냅샷)
-- ──────────────────────────────────────────────────────────
CREATE TABLE wiki.wiki_versions (
  id            TEXT PRIMARY KEY,
  page_id       TEXT NOT NULL,
  title         TEXT NOT NULL,
  content_json  JSONB NOT NULL,
  saved_by_id   TEXT NOT NULL,
  saved_at      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT wiki_versions_page_fkey
    FOREIGN KEY (page_id) REFERENCES wiki.wiki_pages(id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT wiki_versions_saver_fkey
    FOREIGN KEY (saved_by_id) REFERENCES public.users(id) ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX wiki_versions_page_saved_idx ON wiki.wiki_versions(page_id, saved_at DESC);

-- ──────────────────────────────────────────────────────────
-- 댓글 (flat)
-- ──────────────────────────────────────────────────────────
CREATE TABLE wiki.wiki_comments (
  id          TEXT PRIMARY KEY,
  page_id     TEXT NOT NULL,
  author_id   TEXT NOT NULL,
  body        TEXT NOT NULL,
  created_at  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  TIMESTAMP(3) NOT NULL,
  CONSTRAINT wiki_comments_page_fkey
    FOREIGN KEY (page_id) REFERENCES wiki.wiki_pages(id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT wiki_comments_author_fkey
    FOREIGN KEY (author_id) REFERENCES public.users(id) ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX wiki_comments_page_idx ON wiki.wiki_comments(page_id, created_at);
CREATE INDEX wiki_comments_author_idx ON wiki.wiki_comments(author_id);
