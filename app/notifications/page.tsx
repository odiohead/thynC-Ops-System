'use client'

/**
 * 알림함 (1.1 P5 — §6.3·§6.4)
 * 내 알림 전체 목록 + 미읽음/종류 필터 + 일괄 읽음 + 개인 수신 설정.
 */

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

interface Item {
  id: string
  kind: string
  title: string
  body: string | null
  link: string
  refCode: string | null
  severity: string | null
  actorName: string | null
  readAt: string | null
  createdAt: string
}
interface Pref {
  kind: string
  label: string
  inApp: boolean
  slackDm: boolean
  isDefault: boolean
}

const KIND_ICON: Record<string, string> = {
  TICKET_ASSIGNED: '🎫', TICKET_UNASSIGNED_IN_MY_QUEUE: '📥', TICKET_STATUS_CHANGED: '🔄',
  TICKET_COMMENT: '💬', SLA_WARNING: '⏳', SLA_BREACH: '⏰',
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

export default function NotificationsPage() {
  const router = useRouter()
  const [items, setItems] = useState<Item[]>([])
  const [unread, setUnread] = useState(0)
  const [kindLabels, setKindLabels] = useState<Record<string, string>>({})
  const [unreadOnly, setUnreadOnly] = useState(false)
  const [kind, setKind] = useState('')
  const [loading, setLoading] = useState(true)
  const [prefs, setPrefs] = useState<Pref[]>([])
  const [showPrefs, setShowPrefs] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const params = new URLSearchParams({ limit: '100' })
    if (unreadOnly) params.set('unread', '1')
    if (kind) params.set('kind', kind)
    const res = await fetch(`/api/notifications?${params}`)
    if (res.ok) {
      const d = await res.json()
      setItems(d.items ?? [])
      setUnread(d.unreadCount ?? 0)
      setKindLabels(d.kindLabels ?? {})
    }
    setLoading(false)
  }, [unreadOnly, kind])

  useEffect(() => { void load() }, [load])
  useEffect(() => {
    fetch('/api/notifications/prefs').then((r) => (r.ok ? r.json() : null)).then((d) => setPrefs(d?.prefs ?? []))
  }, [])

  async function markAll() {
    await fetch('/api/notifications', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: '{}' })
    await load()
  }

  async function openItem(it: Item) {
    if (!it.readAt) {
      await fetch('/api/notifications', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids: [it.id] }),
      }).catch(() => {})
    }
    router.push(it.link)
  }

  async function savePref(p: Pref, patch: Partial<Pref>) {
    const next = prefs.map((x) => (x.kind === p.kind ? { ...x, ...patch, isDefault: false } : x))
    setPrefs(next)
    await fetch('/api/notifications/prefs', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prefs: [{ kind: p.kind, inApp: patch.inApp ?? p.inApp, slackDm: patch.slackDm ?? p.slackDm }] }),
    })
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
        <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-xl font-bold text-foreground sm:text-2xl">알림함</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              내 티켓 배정·상태 변경·코멘트·SLA 알림 {unread > 0 && <span className="font-medium text-blue-600">· 미읽음 {unread}건</span>}
            </p>
          </div>
          <div className="flex gap-2">
            {unread > 0 && (
              <button type="button" onClick={markAll}
                className="flex-1 rounded-lg border px-3 py-2 text-sm text-muted-foreground hover:bg-accent sm:flex-none">모두 읽음</button>
            )}
            <button type="button" onClick={() => setShowPrefs((v) => !v)}
              className="flex-1 rounded-lg border px-3 py-2 text-sm text-muted-foreground hover:bg-accent sm:flex-none">
              {showPrefs ? '설정 닫기' : '수신 설정'}
            </button>
          </div>
        </div>

        {showPrefs && (
          <section className="mb-5 rounded-xl border bg-card p-4">
            <h2 className="text-sm font-semibold text-foreground">수신 설정</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">종류별로 알림함·Slack DM 수신 여부를 정합니다. 내가 한 행동은 알림이 오지 않습니다.</p>
            <div className="mt-3 space-y-2">
              {prefs.map((p) => (
                <div key={p.kind} className="flex flex-wrap items-center gap-3 border-t pt-2 text-sm">
                  <span className="min-w-[9rem] text-foreground">{KIND_ICON[p.kind] ?? '🔔'} {p.label}</span>
                  <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <input type="checkbox" checked={p.inApp} onChange={(e) => savePref(p, { inApp: e.target.checked })} />
                    알림함
                  </label>
                  <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <input type="checkbox" checked={p.slackDm} onChange={(e) => savePref(p, { slackDm: e.target.checked })} />
                    Slack DM
                  </label>
                  {p.isDefault && <span className="text-[11px] text-muted-foreground opacity-70">기본값</span>}
                </div>
              ))}
            </div>
          </section>
        )}

        <div className="mb-4 flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => setUnreadOnly((v) => !v)}
            className={`rounded-full border px-3 py-1.5 text-xs font-medium ${unreadOnly ? 'border-blue-500 bg-blue-50 text-blue-700' : 'text-muted-foreground'}`}>
            미읽음만
          </button>
          <select value={kind} onChange={(e) => setKind(e.target.value)}
            className="rounded-md border border-border bg-background px-3 py-1.5 text-sm text-foreground">
            <option value="">종류 전체</option>
            {Object.entries(kindLabels).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>

        <div className="space-y-2">
          {loading ? (
            <p className="rounded-xl border bg-card py-12 text-center text-sm text-muted-foreground">불러오는 중...</p>
          ) : items.length === 0 ? (
            <p className="rounded-xl border bg-card py-12 text-center text-sm text-muted-foreground">
              {unreadOnly || kind ? '조건에 맞는 알림이 없습니다.' : '알림이 없습니다.'}
            </p>
          ) : (
            items.map((it) => (
              <button key={it.id} type="button" onClick={() => openItem(it)}
                className={`block w-full rounded-xl border p-4 text-left transition active:scale-[0.99] ${
                  it.readAt ? 'border-border bg-card' : 'border-blue-200 bg-blue-50/60 dark:border-blue-900 dark:bg-blue-900/10'
                }`}>
                <div className="flex items-start gap-2.5">
                  <span className="shrink-0 text-base">{KIND_ICON[it.kind] ?? '🔔'}</span>
                  <div className="min-w-0 flex-1">
                    <p className={`text-sm ${it.readAt ? 'text-foreground' : 'font-semibold text-foreground'}`}>{it.title}</p>
                    {it.body && <p className="mt-0.5 truncate text-xs text-muted-foreground">{it.body}</p>}
                    <p className="mt-1 flex flex-wrap items-center gap-x-2 text-[11px] text-muted-foreground">
                      <span>{kindLabels[it.kind] ?? it.kind}</span>
                      {it.actorName && <span>· {it.actorName}</span>}
                      <span>· {formatDateTime(it.createdAt)}</span>
                    </p>
                  </div>
                  {!it.readAt && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-blue-500" />}
                </div>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
