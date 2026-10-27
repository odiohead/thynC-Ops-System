'use client'

/**
 * 알림 이벤트 탭 (2026-10-27 재편 — projects/domain_event_notify_design.md) — "무슨 일이 생기면 어디로 알림이 가는가"를 이벤트 축으로.
 * 카탈로그(lib/notify-events.ts)의 이벤트를 모듈별로 나열하고, 행마다 사용 스위치 + 그 이벤트의 라우트(채널·조건·멘션)를 인라인으로 편집한다.
 * 구 3겹 토글(전체/업무 타입/티켓 이벤트)은 사용 스위치 + 라우트 조건으로 일원화됨.
 */
import { useCallback, useEffect, useState } from 'react'
import { refTypeLabelMap } from '@/lib/ticket-domains/meta'
import type { NotifyEventDef, NotifyCondition } from '@/lib/notify-events'

const MENTION_LABELS: Record<string, string> = { none: '멘션 없음', queue_members: '그룹 멤버', here: '@here', channel: '@channel' }
const REF_TYPE_LABELS: Record<string, string> = refTypeLabelMap('NONE')
const STATUS_LABELS: Record<string, string> = { OPEN: '접수', ASSIGNED: '배정', IN_PROGRESS: '처리중', PENDING: '대기', RESOLVED: '해결', CLOSED: '종결' }

interface Channel { id: number; name: string; slackChannelId: string; isActive: boolean }
interface Route { id: number; name: string; eventType: string; channelId: number; refTypes: string[]; queueIds: number[]; ctiIds: number[]; severities: string[]; statusTo: string[]; metrics: string[]; mentionMode: string; digestHour: number | null; isActive: boolean; channel: { id: number; name: string; isActive: boolean } }
interface Masters { events: string[]; eventDefs: NotifyEventDef[]; eventGroups: { key: string; label: string; description: string }[]; mentionModes: string[]; metrics: string[]; statuses: string[]; severities: string[]; queues: { id: number; name: string }[] }

export default function EventsTab({ globalEnabled }: { globalEnabled: boolean }) {
  const [channels, setChannels] = useState<Channel[]>([])
  const [routes, setRoutes] = useState<Route[]>([])
  const [masters, setMasters] = useState<Masters | null>(null)
  const [enabled, setEnabled] = useState<Record<string, boolean>>({})
  const [loading, setLoading] = useState(true)
  const [msg, setMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [adding, setAdding] = useState<string | null>(null) // 규칙 추가 폼이 열린 이벤트 키
  const [f, setF] = useState<{ channelId: number | ''; refTypes: string[]; queueIds: number[]; severities: string[]; statusTo: string[]; metrics: string[]; mentionMode: string; name: string }>({ channelId: '', refTypes: [], queueIds: [], severities: [], statusTo: [], metrics: [], mentionMode: 'none', name: '' })

  const load = useCallback(async () => {
    const res = await fetch('/api/settings/notify-routes')
    if (res.ok) { const d = await res.json(); setChannels(d.channels ?? []); setRoutes(d.routes ?? []); setMasters(d.masters ?? null); setEnabled(d.eventEnabled ?? {}) }
    else if (res.status === 403) setMsg('알림 이벤트는 ADMIN 이상만 편집할 수 있습니다.')
    setLoading(false)
  }, [])
  useEffect(() => { void load() }, [load])
  const flash = (m: string) => { setMsg(m); setTimeout(() => setMsg(null), 5000) }

  async function post(body: Record<string, unknown>, okMsg?: string) {
    setBusy(true)
    const res = await fetch('/api/settings/notify-routes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const d = await res.json().catch(() => ({})); setBusy(false)
    if (!res.ok) { flash(d.error ?? '실패했습니다.'); return false }
    if (okMsg) flash(okMsg)
    await load(); return true
  }
  async function patchRoute(id: number, body: Record<string, unknown>) {
    setBusy(true)
    const res = await fetch(`/api/settings/notify-routes/${id}?kind=route`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const d = await res.json().catch(() => ({})); setBusy(false)
    if (!res.ok) { flash(d.error ?? '수정 실패'); return }
    await load()
  }
  async function removeRoute(r: Route) {
    if (!confirm(`규칙 '${r.name}'을(를) 삭제하시겠습니까?`)) return
    setBusy(true)
    const res = await fetch(`/api/settings/notify-routes/${r.id}?kind=route`, { method: 'DELETE' })
    const d = await res.json().catch(() => ({})); setBusy(false)
    if (!res.ok) { flash(d.error ?? '삭제 실패'); return }
    await load()
  }

  const chip = (on: boolean) => `rounded-full border px-2.5 py-1 text-xs ${on ? 'border-blue-500 bg-blue-50 text-blue-700' : 'text-muted-foreground'}`
  const toggle = <T,>(cur: T[], v: T) => (cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v])
  const scope = (r: Route) => {
    const p: string[] = []
    if (r.refTypes.length) p.push(r.refTypes.map((x) => REF_TYPE_LABELS[x] ?? x).join('·'))
    if (r.queueIds.length) p.push(`그룹 ${r.queueIds.map((id) => masters?.queues.find((q) => q.id === id)?.name ?? id).join('·')}`)
    if (r.severities.length) p.push(r.severities.join('·'))
    if (r.statusTo.length) p.push(`→ ${r.statusTo.map((s) => STATUS_LABELS[s] ?? s).join('·')}`)
    if (r.metrics.length) p.push(`metric ${r.metrics.join('·')}`)
    return p.length ? p.join(' / ') : '전체'
  }
  const openAdd = (ev: NotifyEventDef) => { setAdding(ev.key); setF({ channelId: '', refTypes: [], queueIds: [], severities: [], statusTo: [], metrics: [], mentionMode: 'none', name: '' }) }
  const has = (ev: NotifyEventDef, c: NotifyCondition) => ev.conditions.includes(c)

  if (loading) return <p className="py-8 text-center text-sm text-muted-foreground">불러오는 중...</p>
  if (!masters) return <p className="py-8 text-center text-sm text-muted-foreground">{msg ?? '불러오지 못했습니다.'}</p>

  return (
    <div className="space-y-5">
      {msg && <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-2.5 text-sm text-blue-800 dark:border-blue-800 dark:bg-blue-900/20 dark:text-blue-300">{msg}</div>}
      {!globalEnabled && <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-800">알림 전체 사용이 꺼져 있습니다(공통 탭). 아래 설정은 저장되지만 발송되지 않습니다.</div>}
      <p className="text-xs text-muted-foreground">이벤트마다 <b>사용</b> 스위치와 <b>규칙(채널 · 조건 · 멘션)</b>을 둡니다. 조건에 맞는 규칙은 전부 실행되고 같은 채널은 1건으로 합쳐집니다. 규칙이 없는 이벤트는 발송되지 않습니다(Assignment Group에 지정된 그룹 알림 채널은 별도로 더해짐).</p>

      {masters.eventGroups.map((g) => {
        const evs = masters.eventDefs.filter((e) => e.group === g.key)
        if (!evs.length) return null
        return (
          <section key={g.key} className="rounded-xl border bg-card">
            <div className="border-b px-4 py-2.5"><h3 className="text-sm font-semibold text-foreground">{g.label}</h3><p className="text-xs text-muted-foreground">{g.description}</p></div>
            <div className="divide-y">
              {evs.map((ev) => {
                const evRoutes = routes.filter((r) => r.eventType === ev.key)
                const on = enabled[ev.key] !== false
                const effective = ev.implemented && on && evRoutes.some((r) => r.isActive && r.channel.isActive)
                return (
                  <div key={ev.key} className={`px-4 py-3 ${!ev.implemented ? 'opacity-60' : ''}`}>
                    <div className="flex flex-wrap items-start gap-3">
                      <label className={`mt-0.5 flex items-center gap-2 ${ev.implemented ? 'cursor-pointer' : 'cursor-not-allowed'}`} title={ev.implemented ? '이벤트 사용' : '발송 지점 미구현'}>
                        <input type="checkbox" className="h-4 w-4 accent-primary" checked={on} disabled={busy || !ev.implemented} onChange={(e) => post({ kind: 'event-enabled', eventKey: ev.key, enabled: e.target.checked })} />
                      </label>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-medium text-foreground">{ev.label}</span>
                          <span className="font-mono text-[11px] text-muted-foreground">{ev.key}</span>
                          {!ev.implemented && <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">발송 지점 미구현 — 키만 예약</span>}
                          {ev.implemented && (effective ? <span className="rounded bg-green-100 px-1.5 py-0.5 text-[11px] text-green-700">발송 중</span> : <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[11px] text-gray-600">{on ? '규칙 없음 — 발송 안 함' : '사용 중지'}</span>)}
                        </div>
                        <p className="mt-0.5 text-xs text-muted-foreground">{ev.description}</p>
                        {evRoutes.length > 0 && (
                          <div className="mt-2 space-y-1">
                            {evRoutes.map((r) => (
                              <div key={r.id} className={`flex flex-wrap items-center gap-2 rounded-md border px-2.5 py-1.5 text-xs ${r.isActive && r.channel.isActive ? '' : 'opacity-50'}`}>
                                <span className="font-medium text-foreground">#{r.channel.name}</span>{!r.channel.isActive && <span className="text-amber-600">(채널 비활성)</span>}
                                <span className="text-muted-foreground">{scope(r)}</span>
                                <span className="text-muted-foreground">· {MENTION_LABELS[r.mentionMode] ?? r.mentionMode}</span>
                                {ev.kind === 'digest' && r.digestHour != null && <span className="text-muted-foreground">· {String(r.digestHour).padStart(2, '0')}:00</span>}
                                <span className="ml-auto flex gap-1">
                                  <button type="button" disabled={busy} onClick={() => patchRoute(r.id, { isActive: !r.isActive })} className="rounded border px-1.5 py-0.5 text-muted-foreground hover:bg-accent">{r.isActive ? '비활성' : '활성'}</button>
                                  <button type="button" disabled={busy} onClick={() => removeRoute(r)} className="rounded border border-red-200 px-1.5 py-0.5 text-red-500 hover:bg-red-50">삭제</button>
                                </span>
                              </div>
                            ))}
                          </div>
                        )}
                        {ev.implemented && ev.kind !== 'digest' && adding !== ev.key && (
                          <button type="button" onClick={() => openAdd(ev)} className="mt-2 rounded-md border border-dashed px-2.5 py-1 text-xs text-muted-foreground hover:border-blue-400 hover:text-blue-600">+ 규칙 (채널·조건)</button>
                        )}
                        {ev.kind === 'digest' && <p className="mt-1 text-[11px] text-muted-foreground">시각·채널은 공통 탭의 &quot;SLA 초과 일일 요약&quot;에서 설정합니다.</p>}
                        {adding === ev.key && (
                          <div className="mt-2 space-y-3 rounded-lg border bg-muted/30 p-3">
                            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                              <label className="text-xs text-muted-foreground">채널
                                <select value={f.channelId} onChange={(e) => setF({ ...f, channelId: e.target.value ? parseInt(e.target.value) : '' })} className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground">
                                  <option value="">선택</option>
                                  {channels.filter((c) => c.isActive).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                                </select>
                              </label>
                              <label className="text-xs text-muted-foreground">멘션
                                <select value={f.mentionMode} onChange={(e) => setF({ ...f, mentionMode: e.target.value })} className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground">
                                  {masters.mentionModes.map((m) => <option key={m} value={m}>{MENTION_LABELS[m] ?? m}</option>)}
                                </select>
                              </label>
                              <label className="text-xs text-muted-foreground">규칙 이름(선택)
                                <input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder={`${ev.label} → 채널`} className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground" />
                              </label>
                            </div>
                            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                              {has(ev, 'refTypes') && <div><p className="text-xs text-muted-foreground">업무 유형 <span className="opacity-70">(비우면 전체)</span></p><div className="mt-1 flex flex-wrap gap-1.5">{Object.keys(REF_TYPE_LABELS).map((r) => <button key={r} type="button" onClick={() => setF({ ...f, refTypes: toggle(f.refTypes, r) })} className={chip(f.refTypes.includes(r))}>{REF_TYPE_LABELS[r]}</button>)}</div></div>}
                              {has(ev, 'queues') && <div><p className="text-xs text-muted-foreground">Assignment Group <span className="opacity-70">(비우면 전체)</span></p><div className="mt-1 flex flex-wrap gap-1.5">{masters.queues.map((q) => <button key={q.id} type="button" onClick={() => setF({ ...f, queueIds: toggle(f.queueIds, q.id) })} className={chip(f.queueIds.includes(q.id))}>{q.name}</button>)}</div></div>}
                              {has(ev, 'severities') && <div><p className="text-xs text-muted-foreground">Severity <span className="opacity-70">(비우면 전체)</span></p><div className="mt-1 flex flex-wrap gap-1.5">{masters.severities.map((s) => <button key={s} type="button" onClick={() => setF({ ...f, severities: toggle(f.severities, s) })} className={chip(f.severities.includes(s))}>{s}</button>)}</div></div>}
                              {has(ev, 'statusTo') && <div><p className="text-xs text-muted-foreground">이 상태로 바뀔 때만 <span className="opacity-70">(비우면 전체)</span></p><div className="mt-1 flex flex-wrap gap-1.5">{masters.statuses.map((s) => <button key={s} type="button" onClick={() => setF({ ...f, statusTo: toggle(f.statusTo, s) })} className={chip(f.statusTo.includes(s))}>{STATUS_LABELS[s] ?? s}</button>)}</div></div>}
                              {has(ev, 'metrics') && <div><p className="text-xs text-muted-foreground">대상 metric <span className="opacity-70">(비우면 전체)</span></p><div className="mt-1 flex flex-wrap gap-1.5">{masters.metrics.map((m) => <button key={m} type="button" onClick={() => setF({ ...f, metrics: toggle(f.metrics, m) })} className={chip(f.metrics.includes(m))}>{m}</button>)}</div></div>}
                            </div>
                            <div className="flex gap-2">
                              <button type="button" disabled={busy || !f.channelId} onClick={async () => {
                                const chName = channels.find((c) => c.id === f.channelId)?.name ?? ''
                                const ok = await post({ kind: 'route', name: f.name.trim() || `${ev.label} → ${chName}`, eventType: ev.key, channelId: f.channelId, refTypes: f.refTypes, queueIds: f.queueIds, severities: f.severities, statusTo: has(ev, 'statusTo') ? f.statusTo : [], metrics: has(ev, 'metrics') ? f.metrics : [], mentionMode: f.mentionMode }, '규칙을 추가했습니다.')
                                if (ok) setAdding(null)
                              }} className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">추가</button>
                              <button type="button" onClick={() => setAdding(null)} className="rounded-lg border px-3 py-1.5 text-sm text-muted-foreground hover:bg-accent">취소</button>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </section>
        )
      })}
    </div>
  )
}
