'use client'

import { useRouter } from 'next/navigation'
import { ChevronLeft } from 'lucide-react'

/** 상단 제목줄 — safe-area 상단 패딩 포함, 스크롤 시 고정 */
export default function MobileHeader({ title, back, right }: { title: string; back?: boolean | (() => void); right?: React.ReactNode }) {
  const router = useRouter()
  return (
    <header className="sticky top-0 z-30 border-b border-border bg-card/95 backdrop-blur pt-[env(safe-area-inset-top)]">
      <div className="mx-auto flex h-14 max-w-lg items-center gap-1 px-2">
        {back ? (
          <button
            type="button"
            aria-label="뒤로"
            onClick={() => (typeof back === 'function' ? back() : router.back())}
            className="rounded-lg p-2 text-muted-foreground active:bg-accent"
          >
            <ChevronLeft size={24} />
          </button>
        ) : (
          <span className="w-2" />
        )}
        <h1 className="min-w-0 flex-1 truncate text-lg font-semibold">{title}</h1>
        {right && <div className="flex shrink-0 items-center gap-1 pr-1">{right}</div>}
      </div>
    </header>
  )
}
