'use client'

/**
 * 전역 알림 벨 (1.1 P5 — §6.3)
 *
 * 두 소스를 합산해 보여준다:
 *  - 시스템 알림 `/api/notifications` (티켓 배정·상태·코멘트·SLA)
 *  - 위키 알림 `/api/wiki/notifications` (댓글)
 *
 * 위키 알림을 **HTTP로만** 가져온다 — CLAUDE.md 규칙 #7(메인 → 위키 코드 import 금지)에서
 * 허용된 방향이 HTTP 호출이기 때문. 테이블 통합은 하지 않는다(위키 스키마 경계 유지).
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Bell } from 'lucide-react'

interface Item {
  id: string
  source: 'system' | 'wiki'
  kind: string
  title: string
  body?: string | null
  link: string
  readAt: string | null
  createdAt: string
  severity?: string | null
}

function relTime(iso: string): string {
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000)
  if (m < 1) return '방금'
  if (m < 60) return `${m}분 전`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}시간 전`
  const d = Math.floor(h / 24)
  if (d < 30) return `${d}일 전`
  return `${Math.floor(d / 30)}개월 전`
}

const KIND_ICON: Record<string, string> = {
  TICKET_ASSIGNED: '🎫',
  TICKET_UNASSIGNED_IN_MY_QUEUE: '📥',
  TICKET_STATUS_CHANGED: '🔄',
  TICKET_COMMENT: '💬',
  SLA_WARNING: '⏳',
  SLA_BREACH: '⏰',
  comment: '💬',
}

export default function NotificationBell({ compact = false }: { compact?: boolean }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<Item[]>([])
  const [unread, setUnread] = useState(0)
  const ref = useRef<HTMLDivElement>(null)

  const load = useCallback(async () => {
    try {
      const [sysRes, wikiRes] = await Promise.all([
        fetch('/api/notifications?limit=10'),
        fetch('/api/wiki/notifications').catch(() => null),
      ])
      const sys = sysRes.ok ? await sysRes.json() : { items: [], unreadCount: 0 }
      const wiki = wikiRes && wikiRes.ok ? await wikiRes.json() : { items: [], unreadCount: 0 }

      const merged: Item[] = [
        ...(sys.items ?? []).map((n: Item) => ({ ...n, source: 'system' as const })),
        ...(wiki.items ?? []).map((n: { id: string; type: string; pageTitle?: string | null; actorName?: string | null; pageId?: string | null; readAt: string | null; createdAt: string }) => ({
          id: `wiki-${n.id}`,
          source: 'wiki' as const,
          kind: n.type,
          title: `위키 · ${n.pageTitle ?? '페이지'}`,
          body: n.actorName ? `${n.actorName}님의 댓글` : null,
          link: n.pageId ? `/wiki/${n.pageId}` : '/wiki',
          readAt: n.readAt,
          createdAt: n.createdAt,
        })),
      ].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())

      setItems(merged.slice(0, 12))
      setUnread((sys.unreadCount ?? 0) + (wiki.unreadCount ?? 0))
    } catch {
      /* 벨은 부가 기능 — 실패해도 조용히 */
    }
  }, [])

  useEffect(() => {
    void load()
    const t = setInterval(load, 60_000) // 60초 폴링 (위키 벨과 동일 주기)
    return () => clearInterval(t)
  }, [load])

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [])

  async function openItem(it: Item) {
    setOpen(false)
    if (!it.readAt) {
      if (it.source === 'system') {
        await fetch('/api/notifications', {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ids: [it.id] }),
        }).catch(() => {})
      } else {
        await fetch('/api/wiki/notifications', {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ids: [it.id.replace(/^wiki-/, '')] }),
        }).catch(() => {})
      }
      void load()
    }
    router.push(it.link)
  }

  async function markAll() {
    await Promise.all([
      fetch('/api/notifications', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: '{}' }).catch(() => {}),
      fetch('/api/wiki/notifications', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: '{}' }).catch(() => {}),
    ])
    void load()
  }

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={`알림${unread > 0 ? ` ${unread}건` : ''}`}
        className={`relative rounded-lg p-2 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-800 dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-gray-100 ${compact ? '' : ''}`}
      >
        <Bell size={18} />
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 min-w-[1.05rem] rounded-full bg-red-500 px-1 text-[10px] font-bold leading-[1.05rem] text-white">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 z-50 mt-2 w-80 max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-gray-200 bg-white shadow-xl dark:border-gray-700 dark:bg-gray-800">
          <div className="flex items-center justify-between border-b border-gray-100 px-3 py-2 dark:border-gray-700">
            <span className="text-sm font-semibold text-gray-800 dark:text-gray-100">알림 {unread > 0 && `(${unread})`}</span>
            <div className="flex items-center gap-2">
              {unread > 0 && (
                <button type="button" onClick={markAll} className="text-xs text-gray-400 hover:text-gray-700 dark:hover:text-gray-200">모두 읽음</button>
              )}
              <Link href="/notifications" onClick={() => setOpen(false)} className="text-xs text-blue-500 hover:underline">전체</Link>
            </div>
          </div>

          <div className="max-h-96 divide-y divide-gray-50 overflow-y-auto dark:divide-gray-700/60">
            {items.length === 0 ? (
              <p className="px-3 py-8 text-center text-xs text-gray-400">알림이 없습니다.</p>
            ) : (
              items.map((it) => (
                <button
                  key={it.id}
                  type="button"
                  onClick={() => openItem(it)}
                  className={`block w-full px-3 py-2.5 text-left transition-colors hover:bg-gray-50 dark:hover:bg-gray-700/50 ${it.readAt ? '' : 'bg-blue-50/50 dark:bg-blue-900/10'}`}
                >
                  <div className="flex items-start gap-2">
                    <span className="shrink-0 text-sm">{KIND_ICON[it.kind] ?? '🔔'}</span>
                    <div className="min-w-0 flex-1">
                      <p className={`truncate text-sm ${it.readAt ? 'text-gray-600 dark:text-gray-300' : 'font-medium text-gray-900 dark:text-gray-50'}`}>{it.title}</p>
                      {it.body && <p className="truncate text-xs text-gray-400">{it.body}</p>}
                      <p className="mt-0.5 text-[11px] text-gray-400">{relTime(it.createdAt)}</p>
                    </div>
                    {!it.readAt && <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-blue-500" />}
                  </div>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}
