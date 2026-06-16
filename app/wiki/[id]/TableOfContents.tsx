'use client'

export type Heading = { id: string; text: string; level: number }

/**
 * 본문 heading 블록으로 만든 목차. 넓은 화면(xl+)에서만 우측에 floating.
 */
export default function TableOfContents({ headings }: { headings: Heading[] }) {
  const visible = headings.filter((h) => h.text.trim().length > 0)
  if (visible.length < 2) return null

  const jump = (id: string) => {
    const el = document.querySelector(`[data-id="${id}"]`)
    el?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const minLevel = Math.min(...visible.map((h) => h.level))

  return (
    <nav className="fixed right-6 top-28 hidden w-52 xl:block">
      <div className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-[var(--wiki-text-muted)]">
        목차
      </div>
      <ul className="space-y-0.5 border-l border-[var(--wiki-border)]">
        {visible.map((h) => (
          <li key={h.id}>
            <button
              onClick={() => jump(h.id)}
              className="block w-full truncate border-l-2 border-transparent py-0.5 pr-1 text-left text-xs text-[var(--wiki-text-soft)] transition hover:border-[var(--wiki-accent)] hover:text-[var(--wiki-text)]"
              style={{ paddingLeft: (h.level - minLevel) * 12 + 10 }}
              title={h.text}
            >
              {h.text}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  )
}

export function extractHeadings(blocks: unknown): Heading[] {
  if (!Array.isArray(blocks)) return []
  const out: Heading[] = []
  for (const raw of blocks as unknown[]) {
    if (!raw || typeof raw !== 'object') continue
    const b = raw as {
      id?: string
      type?: string
      props?: { level?: number }
      content?: unknown
    }
    if (b.type === 'heading' && b.id) {
      const text = Array.isArray(b.content)
        ? (b.content as unknown[])
            .map((c) => (c && typeof c === 'object' ? ((c as { text?: string }).text ?? '') : ''))
            .join('')
        : ''
      out.push({ id: b.id, text, level: b.props?.level ?? 1 })
    }
  }
  return out
}
