'use client'

/** Slack 발송 채널 마스터 탭 (2026-10-27 재편 — 구 RoutesTab 상단 분리). 등록 시 연결 테스트로 실제 도착 확인 */
import { useCallback, useEffect, useState } from 'react'

interface Channel { id: number; name: string; slackChannelId: string; description: string | null; isActive: boolean; sortOrder: number; _count?: { routes: number } }

export default function ChannelsTab() {
  const [channels, setChannels] = useState<Channel[]>([])
  const [loading, setLoading] = useState(true)
  const [msg, setMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [chName, setChName] = useState('')
  const [chId, setChId] = useState('')
  const [chDesc, setChDesc] = useState('')

  const load = useCallback(async () => {
    const res = await fetch('/api/settings/notify-routes')
    if (res.ok) setChannels((await res.json()).channels ?? [])
    else if (res.status === 403) setMsg('채널은 ADMIN 이상만 편집할 수 있습니다.')
    setLoading(false)
  }, [])
  useEffect(() => { void load() }, [load])
  const flash = (m: string) => { setMsg(m); setTimeout(() => setMsg(null), 5000) }

  async function post(body: Record<string, unknown>, okMsg: string) {
    setBusy(true)
    const res = await fetch('/api/settings/notify-routes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const d = await res.json().catch(() => ({}))
    setBusy(false)
    if (!res.ok) { flash(d.error ?? '실패했습니다.'); return false }
    flash(d.note ? `${okMsg} — ${d.note}` : okMsg); await load(); return true
  }
  async function patch(id: number, body: Record<string, unknown>) {
    setBusy(true)
    const res = await fetch(`/api/settings/notify-routes/${id}?kind=channel`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const d = await res.json().catch(() => ({})); setBusy(false)
    if (!res.ok) { flash(d.error ?? '수정 실패'); return }
    await load()
  }
  async function remove(c: Channel) {
    if (!confirm(`'${c.name}'을(를) 삭제하시겠습니까?\n연결된 규칙 ${c._count?.routes ?? 0}건도 함께 삭제됩니다.`)) return
    setBusy(true)
    const res = await fetch(`/api/settings/notify-routes/${c.id}?kind=channel`, { method: 'DELETE' })
    const d = await res.json().catch(() => ({})); setBusy(false)
    if (!res.ok) { flash(d.error ?? '삭제 실패'); return }
    if (d.deletedRoutes) flash(`채널과 연결 규칙 ${d.deletedRoutes}건을 삭제했습니다.`)
    await load()
  }

  if (loading) return <p className="py-8 text-center text-sm text-muted-foreground">불러오는 중...</p>
  const dupIds = new Set(channels.map((c) => c.slackChannelId).filter((id, i, a) => a.indexOf(id) !== i))

  return (
    <div className="space-y-4">
      {msg && <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-2.5 text-sm text-blue-800 dark:border-blue-800 dark:bg-blue-900/20 dark:text-blue-300">{msg}</div>}
      <section className="rounded-xl border bg-card">
        <div className="border-b px-4 py-3">
          <h3 className="text-sm font-semibold text-foreground">발송 채널</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">Slack 채널 ID(예: C09XXXXXXXX)를 등록합니다. 등록 후 <b>연결 테스트</b>로 실제 도착을 확인하세요. 발송 모드가 test면 테스트 채널로 라우팅되고, off면 발송되지 않습니다. 어느 이벤트가 이 채널로 가는지는 <b>이벤트 탭</b>에서 정합니다.</p>
        </div>
        <div className="divide-y">
          {channels.map((c) => (
            <div key={c.id} className={`flex flex-wrap items-center gap-2 px-4 py-2.5 ${c.isActive ? '' : 'opacity-50'}`}>
              <span className="text-sm font-medium text-foreground">{c.name}</span>
              <span className="font-mono text-xs text-muted-foreground">{c.slackChannelId}</span>
              {dupIds.has(c.slackChannelId) && <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[11px] text-amber-700" title="다른 표시명과 같은 Slack 채널 ID">같은 채널 ID 중복</span>}
              {c.description && <span className="text-xs text-muted-foreground">— {c.description}</span>}
              <span className="text-xs text-muted-foreground">규칙 {c._count?.routes ?? 0}건</span>
              <div className="ml-auto flex gap-1.5">
                <button type="button" disabled={busy} onClick={() => post({ kind: 'test', channelId: c.id }, `'${c.name}' 테스트 발송 요청 완료`)} className="rounded-md border px-2 py-1 text-xs text-muted-foreground hover:bg-accent">연결 테스트</button>
                <button type="button" disabled={busy} onClick={() => patch(c.id, { isActive: !c.isActive })} className="rounded-md border px-2 py-1 text-xs text-muted-foreground hover:bg-accent">{c.isActive ? '비활성' : '활성'}</button>
                <button type="button" disabled={busy} onClick={() => remove(c)} className="rounded-md border border-red-200 px-2 py-1 text-xs text-red-500 hover:bg-red-50">삭제</button>
              </div>
            </div>
          ))}
          {channels.length === 0 && <p className="px-4 py-6 text-center text-sm text-muted-foreground">등록된 채널이 없습니다.</p>}
        </div>
        <div className="flex flex-wrap items-end gap-2 border-t bg-muted/30 px-4 py-3">
          <label className="text-xs text-muted-foreground">표시명<input value={chName} onChange={(e) => setChName(e.target.value)} placeholder="운영 공지" className="mt-1 block w-36 rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground" /></label>
          <label className="text-xs text-muted-foreground">Slack 채널 ID<input value={chId} onChange={(e) => setChId(e.target.value)} placeholder="C09XXXXXXXX" className="mt-1 block w-40 rounded-md border border-border bg-background px-2 py-1.5 font-mono text-sm text-foreground" /></label>
          <label className="min-w-[10rem] flex-1 text-xs text-muted-foreground">설명(선택)<input value={chDesc} onChange={(e) => setChDesc(e.target.value)} className="mt-1 block w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground" /></label>
          <button type="button" disabled={busy} onClick={async () => { if (await post({ kind: 'channel', name: chName, slackChannelId: chId, description: chDesc }, '채널을 추가했습니다.')) { setChName(''); setChId(''); setChDesc('') } }} className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">+ 채널 추가</button>
        </div>
      </section>
    </div>
  )
}
