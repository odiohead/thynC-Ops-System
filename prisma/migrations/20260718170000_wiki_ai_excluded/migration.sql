-- 위키 페이지를 AI 어시스턴트 검색에서 제외하는 플래그 (하위 페이지까지 cascade 적용은 조회 계층에서 처리)
ALTER TABLE wiki.wiki_pages ADD COLUMN IF NOT EXISTS ai_excluded boolean NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS wiki_pages_ai_excluded_idx ON wiki.wiki_pages (ai_excluded) WHERE ai_excluded = true;
