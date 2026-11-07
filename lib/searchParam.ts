/**
 * 목록 검색어 파라미터 공통 정규화 (2026-11-06) — 앞뒤 공백 제거, 공백만이면 '' (= 검색 미적용).
 * 1.0 시기 `search` 파라미터 라우트 15곳이 `searchParams.get('search') ?? ''`를 그대로 contains에 넣어
 * 앞뒤 공백이 붙은 검색어(복사·붙여넣기, 모바일 자동완성)가 0건이 되던 문제의 단일 수정점.
 * `q` 파라미터 도메인(VOC·AS·티켓 등)은 이미 `?.trim()` — 신규 라우트도 이 헬퍼를 쓸 것.
 */

/** API 라우트용 — `readSearch(request.nextUrl.searchParams)` / 다른 키면 두 번째 인자 */
export function readSearch(sp: URLSearchParams, key = 'search'): string {
  return (sp.get(key) ?? '').trim()
}

/** 서버 컴포넌트 `searchParams` 객체용 — string | string[] | undefined */
export function trimSearch(v: string | string[] | undefined | null): string {
  const s = Array.isArray(v) ? v[0] : v
  return (s ?? '').trim()
}
