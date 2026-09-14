'use client'

import { useEffect, useState } from 'react'

export type Heading = { id: string; text: string; level: number }

/**
 * 본문 900px 컬럼이 스크롤 컨테이너(main.wiki-scroll) 가운데에 놓이고, 목차는 그 컨테이너 우측 끝에
 * 고정(fixed right-6, 폭 208px)된다. 컨테이너 폭이 (900 + 2×(208+24+16)) ≈ 1,396px보다 좁으면 목차가
 * 본문 텍스트 위에 겹친다(2026-09-12 검토 A-10 — 1,366/1,440/1,536px 노트북에서 재현).
 * 전역 내비(240px)·위키 사이드바(288px, 접기 가능) 폭이 뷰포트마다 달라 미디어쿼리로는 못 잡으므로
 * 컨테이너 실폭을 ResizeObserver로 재서 여유가 있을 때만 표시한다.
 */
const MIN_CONTAINER_WIDTH = 1400

function useTocFits(): boolean {
  const [fits, setFits] = useState(false)
  useEffect(() => {
    const el = document.querySelector<HTMLElement>('main.wiki-scroll')
    if (!el) return
    const update = () => setFits(el.clientWidth >= MIN_CONTAINER_WIDTH)
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return fits
}

/**
 * 본문 heading 블록으로 만든 목차. 컨테이너에 여유 폭이 있을 때만 우측에 floating.
 */
export default function TableOfContents({ headings }: { headings: Heading[] }) {
  const fits = useTocFits()
  const visible = headings.filter((h) => h.text.trim().length > 0)
  if (!fits || visible.length < 2) return null

  const jump = (id: string) => {
    const el = document.querySelector(`[data-id="${id}"]`)
    el?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const minLevel = Math.min(...visible.map((h) => h.level))

  return (
    <nav className="fixed right-6 top-28 w-52 rounded-[6px] bg-[var(--wiki-bg)]">
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
