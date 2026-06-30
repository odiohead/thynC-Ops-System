-- 위키 실시간 동시편집(Yjs) 영속화
-- 협업 문서의 진실의 원천(Y.Doc 바이너리 상태) 저장 테이블
CREATE TABLE wiki.wiki_page_ydoc (
  page_id    text PRIMARY KEY REFERENCES wiki.wiki_pages(id) ON DELETE CASCADE,
  state      bytea NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 페이지별 협업 활성 플래그 (점진 전환용). true면 Yjs 협업 모드, false면 기존 단일작성 자동저장 모드
ALTER TABLE wiki.wiki_pages ADD COLUMN collab_enabled boolean NOT NULL DEFAULT false;
