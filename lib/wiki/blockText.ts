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
