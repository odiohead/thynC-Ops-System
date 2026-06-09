-- 위키 페이지 ↔ 메인 도메인 객체(병원/프로젝트) 명시적 참조 인덱스 (Phase 6)
-- ref_type: 'hospital' | 'project' (확장 시 'task' 등)
-- ref_code: 해당 도메인의 고유 코드 (hospital_code / project_code)
-- 의존성 방향 유지: wiki → public (FK는 application 단에서 검증, DB FK는 의도적으로 안 검 — ref_code는 메인 도메인 코드라 다양한 테이블 참조)

CREATE TABLE wiki.wiki_page_references (
  id           TEXT PRIMARY KEY,
  page_id      TEXT NOT NULL,
  ref_type     TEXT NOT NULL,
  ref_code     TEXT NOT NULL,
  created_by   TEXT NOT NULL,
  created_at   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT wiki_page_references_page_fkey
    FOREIGN KEY (page_id) REFERENCES wiki.wiki_pages(id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT wiki_page_references_creator_fkey
    FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX wiki_page_references_unique_idx
  ON wiki.wiki_page_references(page_id, ref_type, ref_code);

CREATE INDEX wiki_page_references_type_code_idx
  ON wiki.wiki_page_references(ref_type, ref_code);

CREATE INDEX wiki_page_references_page_id_idx
  ON wiki.wiki_page_references(page_id);
