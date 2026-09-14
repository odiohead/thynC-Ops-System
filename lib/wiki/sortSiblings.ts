/**
 * 위키 형제 페이지 정렬 규칙 — 단일 소스.
 *
 * 사이드바(WikiSidebar)·이동 모달(MovePageModal)·이동 API(move/route.ts)·하위 페이지 목록이
 * 같은 규칙을 써야 "화면에서 보이는 이웃"과 "서버가 교환하는 이웃"이 일치한다.
 * (2026-09-12 검토 A-8: 서버는 createdAt, 클라이언트는 title로 동률을 풀어 ↑↓가 엉뚱한 페이지와 바뀌던 문제)
 */
export type SiblingLike = { sortOrder: number; title: string }

export function compareSiblings(a: SiblingLike, b: SiblingLike): number {
  return a.sortOrder - b.sortOrder || a.title.localeCompare(b.title)
}

export function sortSiblings<T extends SiblingLike>(items: readonly T[]): T[] {
  return [...items].sort(compareSiblings)
}
