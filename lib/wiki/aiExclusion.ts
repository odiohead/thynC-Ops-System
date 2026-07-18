import { prisma } from '../prisma'

/**
 * AI 어시스턴트 검색 제외 — 위키 페이지의 `ai_excluded` 플래그와 그 하위(cascade) 처리
 *
 * 관리자가 특정 페이지(보통 카테고리)를 제외로 표시하면, 그 페이지와 **모든 하위 페이지**가
 * 어시스턴트의 search_wiki/read_wiki_page/read_hospital_note 대상에서 빠진다.
 * 제외 판정은 저장 시점이 아니라 조회 시점에 계층으로 계산한다(부모 이동·제외 변경에 자동 반응).
 */

/** ai_excluded=true인 페이지들과 그 전체 하위 서브트리의 페이지 id 집합 (재귀 CTE) */
export async function getAiExcludedPageIds(): Promise<Set<string>> {
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    WITH RECURSIVE excluded AS (
      SELECT id FROM wiki.wiki_pages
        WHERE ai_excluded = true AND deleted_at IS NULL
      UNION
      SELECT c.id FROM wiki.wiki_pages c
        JOIN excluded e ON c.parent_id = e.id
        WHERE c.deleted_at IS NULL
    )
    SELECT id FROM excluded
  `
  return new Set(rows.map((r) => r.id))
}

/** 단일 페이지가 제외 대상인지(자신이 제외거나, 제외된 조상 아래인지) */
export async function isPageAiExcluded(pageId: string): Promise<boolean> {
  const rows = await prisma.$queryRaw<{ hit: boolean }[]>`
    WITH RECURSIVE chain AS (
      SELECT id, parent_id, ai_excluded FROM wiki.wiki_pages WHERE id = ${pageId}
      UNION
      SELECT p.id, p.parent_id, p.ai_excluded FROM wiki.wiki_pages p
        JOIN chain ch ON p.id = ch.parent_id
    )
    SELECT bool_or(ai_excluded) AS hit FROM chain
  `
  return rows[0]?.hit === true
}
