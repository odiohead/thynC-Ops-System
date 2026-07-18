-- 위키 HTML 문서 페이지 지원: 페이지 타입('block'|'html') + 원본 HTML 저장 컬럼
ALTER TABLE wiki.wiki_pages
  ADD COLUMN page_type VARCHAR(10) NOT NULL DEFAULT 'block',
  ADD COLUMN content_html TEXT;
