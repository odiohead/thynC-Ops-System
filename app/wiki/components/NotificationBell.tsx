'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'

type Noti = {
  id: string
  type: string
  pageId: string | null
  pageTitle: string | null
  actorName: string | null
  readAt: string | null
  createdAt: string
}

function relTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1) return '방금'
  if (m < 60) return `${m}분 전`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}시간 전`
  return `${Math.floor(h / 24)}일 전`
}

export default function NotificationBell() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<Noti[]>([])
  const [unread, setUnread] = useState(0)
  const ref = useRef<HTMLDivElement>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/wiki/notifications')
      if (!res.ok) return
      const data = await res.json()
      setItems(data.items ?? [])
      setUnread(data.unreadCount ?? 0)
    } catch {
      /* ignore */
    }
  }, [])

  useEffect(() => {
    load()
    const t = setInterval(load, 60000)
    return () => clearInterval(t)
  }, [load])

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  const openPanel = async () => {
    setOpen((o) => !o)
    if (!open && unread > 0) {
      await fetch('/api/wiki/notifications', { method: 'PATCH', body: JSON.stringify({}) })
      setUnread(0)
      setItems((prev) => prev.map((n) => ({ ...n, readAt: n.readAt ?? new Date().toISOString() })))
    }
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={openPanel}
        className="relative rounded-[6px] px-1.5 py-1 text-[var(--wiki-text-muted)] transition hover:bg-[var(--wiki-hover)] hover:text-[var(--wiki-text)]"
        title="알림"
      >
        🔔
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[9px] font-bold text-white">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>
      {open && (
        <div className="wiki-modal-panel absolute right-0 z-30 mt-1 max-h-96 w-72 overflow-y-auto rounded-[8px] border border-[var(--wiki-border)] bg-[var(--wiki-bg)] py-1 shadow-[var(--wiki-shadow-md)]">
          <div className="px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-[var(--wiki-text-muted)]">
            알림
          </div>
          {items.length === 0 ? (
            <div className="px-3 py-6 text-center text-xs text-[var(--wiki-text-muted)]">
              알림이 없습니다
            </div>
          ) : (
            items.map((n) => (
              <button
                key={n.id}
                onClick={() => {
                  setOpen(false)
                  if (n.pageId) router.push(`/wiki/${n.pageId}`)
                }}
                className={`block w-full px-3 py-2 text-left transition hover:bg-[var(--wiki-hover)] ${
                  n.readAt ? '' : 'bg-[var(--wiki-accent-soft)]'
                }`}
              >
                <div className="text-xs text-[var(--wiki-text)]">
                  <span className="font-medium">{n.actorName ?? '누군가'}</span>
                  님이 <span className="font-medium">{n.pageTitle ?? '페이지'}</span>에 댓글을
                  남겼습니다
                </div>
                <div className="mt-0.5 text-[10px] text-[var(--wiki-text-muted)]">
                  {relTime(n.createdAt)}
                </div>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  )
}
