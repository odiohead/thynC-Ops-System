'use client'

import { useEffect, useMemo, useRef, useState } from 'react'

/**
 * 경량 이모지 피커. 외부 패키지 없이 큐레이션 세트만 제공 (번들 영향 0).
 * 페이지 아이콘 선택용.
 */
const EMOJI_GROUPS: { label: string; emojis: string[] }[] = [
  {
    label: '문서·업무',
    emojis: ['📄', '📃', '📑', '📋', '📝', '🗒️', '📓', '📔', '📒', '📕', '📗', '📘', '📙', '📚', '🔖', '🏷️', '📌', '📎', '🗂️', '📁', '📂', '🗃️', '🗄️', '📊', '📈', '📉', '🧾', '🧮'],
  },
  {
    label: '기호·상태',
    emojis: ['✅', '☑️', '✔️', '❌', '⚠️', '❗', '❓', '💡', '🔥', '⭐', '🌟', '✨', '🎯', '🚀', '🔔', '📣', '🔒', '🔑', '🛠️', '⚙️', '🧩', '🔗', '🧭', '⏰'],
  },
  {
    label: '사람·조직',
    emojis: ['👤', '👥', '🧑‍💻', '👩‍⚕️', '🧑‍🔧', '🏢', '🏥', '🏬', '🤝', '📞', '✉️', '💬', '🗣️', '🧠', '🙌', '👍'],
  },
  {
    label: '기타',
    emojis: ['🏠', '🌐', '🗓️', '📅', '🧪', '💊', '🩺', '🔋', '💻', '🖥️', '📦', '🚗', '🛰️', '🧯', '♻️', '🎉'],
  },
]

const ALL = EMOJI_GROUPS.flatMap((g) => g.emojis)

type Props = {
  onSelect: (emoji: string | null) => void
  onClose: () => void
}

export default function EmojiPicker({ onSelect, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const [q, setQ] = useState('')

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  // 검색은 그룹 라벨 매칭으로 단순 필터 (이모지 자체엔 텍스트가 없으므로)
  const filtered = useMemo(() => {
    const term = q.trim()
    if (!term) return null
    const matchedGroups = EMOJI_GROUPS.filter((g) => g.label.includes(term))
    return matchedGroups.length ? matchedGroups.flatMap((g) => g.emojis) : ALL
  }, [q])

  return (
    <div
      ref={ref}
      className="wiki-modal-panel absolute z-40 mt-1 w-[300px] rounded-[10px] border border-[var(--wiki-border)] bg-[var(--wiki-bg)] p-2 shadow-[var(--wiki-shadow-md)]"
    >
      <div className="mb-2 flex items-center gap-2">
        <input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="카테고리 검색 (예: 문서, 상태)"
          className="flex-1 rounded-[6px] border border-[var(--wiki-border)] px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--wiki-accent)]"
        />
        <button
          onClick={() => onSelect(null)}
          className="rounded-[6px] px-2 py-1 text-xs text-[var(--wiki-text-soft)] transition hover:bg-[var(--wiki-hover)]"
          title="아이콘 제거"
        >
          제거
        </button>
      </div>
      <div className="wiki-scroll max-h-[240px] overflow-y-auto">
        {filtered ? (
          <div className="grid grid-cols-8 gap-0.5">
            {filtered.map((e, i) => (
              <EmojiBtn key={`${e}-${i}`} emoji={e} onSelect={onSelect} />
            ))}
          </div>
        ) : (
          EMOJI_GROUPS.map((g) => (
            <div key={g.label} className="mb-2">
              <div className="px-1 pb-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--wiki-text-muted)]">
                {g.label}
              </div>
              <div className="grid grid-cols-8 gap-0.5">
                {g.emojis.map((e, i) => (
                  <EmojiBtn key={`${e}-${i}`} emoji={e} onSelect={onSelect} />
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

function EmojiBtn({ emoji, onSelect }: { emoji: string; onSelect: (e: string) => void }) {
  return (
    <button
      onClick={() => onSelect(emoji)}
      className="flex h-8 w-8 items-center justify-center rounded-[6px] text-lg transition hover:bg-[var(--wiki-hover)]"
    >
      {emoji}
    </button>
  )
}
