/**
 * BlockNote JSON 본문에서 검색용 plain text 추출.
 * 모든 블록의 `content[].text`와 자식 블록을 재귀로 모아 한 줄 공백 정리해 반환.
 */
export function extractPlainTextFromBlocks(blocks: unknown): string {
  if (!Array.isArray(blocks)) return ''
  const parts: string[] = []
  walk(blocks as unknown[])
  function walk(items: unknown[]) {
    for (const raw of items) {
      if (!raw || typeof raw !== 'object') continue
      const b = raw as {
        content?: unknown
        children?: unknown
      }
      if (Array.isArray(b.content)) {
        for (const c of b.content as unknown[]) {
          if (!c || typeof c !== 'object') continue
          const text = (c as { text?: unknown }).text
          if (typeof text === 'string') parts.push(text)
          // mention/page 같은 inline content는 label/title prop 포함
          const props = (c as { props?: { label?: unknown; title?: unknown } }).props
          if (props) {
            if (typeof props.label === 'string') parts.push(props.label)
            if (typeof props.title === 'string') parts.push(props.title)
          }
        }
      }
      // page block 같은 콘텐츠 없는 블록의 props도 검색에 포함
      const props = (b as { props?: { title?: unknown } }).props
      if (props && typeof props.title === 'string') parts.push(props.title)
      if (Array.isArray(b.children)) walk(b.children as unknown[])
    }
  }
  return parts.join(' ').replace(/\s+/g, ' ').trim()
}

/**
 * BlockNote 본문에서 다른 위키 페이지로의 링크(wikiPageLink 블록) 대상 id를 수집.
 * 백링크 인덱스(wiki_page_links) 갱신용. 중복 제거된 id 배열 반환.
 */
export function extractPageLinks(blocks: unknown): string[] {
  if (!Array.isArray(blocks)) return []
  const ids = new Set<string>()
  walk(blocks as unknown[])
  function walk(items: unknown[]) {
    for (const raw of items) {
      if (!raw || typeof raw !== 'object') continue
      const b = raw as { type?: string; props?: { pageId?: unknown }; children?: unknown }
      if (b.type === 'wikiPageLink') {
        const pid = b.props?.pageId
        if (typeof pid === 'string' && pid) ids.add(pid)
      }
      if (Array.isArray(b.children)) walk(b.children as unknown[])
    }
  }
  return Array.from(ids)
}

/**
 * 본문 내 특정 페이지를 가리키는 wikiPageLink 블록의 title prop을 새 제목으로 갱신.
 * 대상 페이지 제목 변경 시, 그 페이지를 링크한 다른 페이지 본문의 링크 라벨을 동기화하는 용도.
 * 매칭 블록만 새 객체로 교체(나머지는 참조 유지)하고, 실제 변경 여부를 함께 반환.
 */
export function updatePageLinkTitles(
  blocks: unknown,
  targetPageId: string,
  newTitle: string,
): { blocks: unknown; changed: boolean } {
  if (!Array.isArray(blocks)) return { blocks, changed: false }
  let changed = false
  function walk(items: unknown[]): unknown[] {
    return items.map((raw) => {
      if (!raw || typeof raw !== 'object') return raw
      const b = raw as {
        type?: string
        props?: { pageId?: unknown; title?: unknown }
        children?: unknown
      }
      let next: Record<string, unknown> = b as Record<string, unknown>
      if (b.type === 'wikiPageLink' && b.props?.pageId === targetPageId && b.props?.title !== newTitle) {
        next = { ...b, props: { ...b.props, title: newTitle } }
        changed = true
      }
      const children = (next as { children?: unknown }).children
      if (Array.isArray(children)) {
        next = { ...next, children: walk(children as unknown[]) }
      }
      return next
    })
  }
  const result = walk(blocks as unknown[])
  return { blocks: result, changed }
}
