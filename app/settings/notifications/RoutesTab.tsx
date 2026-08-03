'use client'

/**
 * 발송 채널·라우팅 규칙 탭 (1.1 P3 — projects/notification_v1.1_design.md §5.1·§5.5 탭②)
 *
 * - 채널: Slack 채널 등록·활성·**연결 테스트 발송**(잘못된 채널에 업무 정보가 새는 사고를 등록 시점에 차단)
 * - 규칙: 이벤트 × 조건(유형·Assignment Group·Sev·전이 후 상태·metric) → 채널.
 *   매칭된 규칙은 **전부 실행**되고 같은 채널은 1건으로 합쳐진다(SLA 정책은 1개만 승리 — 차이를 화면에 명시)
 * - 일일 요약 규칙에는 **발송 시각(KST)** 과 포함 섹션·그룹 기준을 지정한다
 */

import { useCallback, useEffect, useState } from 'react'

const EVENT_LABELS: Record<string, string> = {
  TICKET_CREATED: '티켓 등록',
  TICKET_STATUS_CHANGED: '상태 변경',
  TICKET_QUEUE_TRANSFERRED: '그룹 이관',
  SEV_ESCALATED: 'Sev 상향(1·2)',
  SLA_BREACH: 'SLA 초과 (즉시)',
  SLA_WARNING: 'SLA 임박',
  DAILY_DIGEST: '일일 요약 (지정 시각)',
}
const MENTION_LABELS: Record<string, string> = {
  none: '멘션 없음',
  queue_members: '그룹 멤버',
  here: '@here',
  channel: '@channel',
}
const REF_TYPE_LABELS: Record<string, string> = {
  MAINTENANCE: '유지보수', ETC: '기타업무', SITE_VISIT: '답사',
  INSTALL_PLAN: '설치계획', PROJECT: '프로젝트', NONE: '순수 티켓',
}
const STATUS_LABELS: Record<string, string> = {
  OPEN: '접수', ASSIGNED: '배정', IN_PROGRESS: '처리중', PENDING: '대기', RESOLVED: '해결', CLOSED: '종결',
}

interface Channel {
  id: number
  name: string
  slackChannelId: string
  description: string | null
  isActive: boolean
  sortOrder: number
  _count?: { routes: number }
}
interface Route {
  id: number
  name: string
  eventType: string
  channelId: number
  refTypes: string[]
  queueIds: number[]
  ctiIds: number[]
  severities: string[]
  statusTo: string[]
  metrics: string[]
  mentionMode: string
  digestHour: number | null
  digestOpts: { kinds?: string[]; groupBy?: string; maxPerSection?: number } | null
  isActive: boolean
  sortOrder: number
  channel: { id: number; name: string; isActive: boolean }
}
interface Masters {
  events: string[]
  mentionModes: string[]
  metrics: string[]
  statuses: string[]
  severities: string[]
  queues: { id: number; name: string }[]
  ctiNodes: { id: number; parentId: number | null; level: number; name: string }[]
}

export default function RoutesTab() {
  const [channels, setChannels] = useState<Channel[]>([])
  const [routes, setRoutes] = useState<Route[]>([])
  const [masters, setMasters] = useState<Masters | null>(null)
  const [loading, setLoading] = useState(true)
  const [msg, setMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // 채널 추가 폼
  const [chName, setChName] = useState('')
  const [chId, setChId] = useState('')
  const [chDesc, setChDesc] = useState('')

  // 규칙 추가 폼
  const [addRoute, setAddRoute] = useState(false)
  const [rName, setRName] = useState('')
  const [rEvent, setREvent] = useState('TICKET_CREATED')
  const [rChannel, setRChannel] = useState<number | ''>('')
  const [rRefTypes, setRRefTypes] = useState<string[]>([])
  const [rQueueIds, setRQueueIds] = useState<number[]>([])
  const [rSeverities, setRSeverities] = useState<string[]>([])
  const [rStatusTo, setRStatusTo] = useState<string[]>([])
  const [rMetrics, setRMetrics] = useState<string[]>([])
  const [rMention, setRMention] = useState('none')
  const [rHour, setRHour] = useState(9)

  const load = useCallback(async () => {
    const res = await fetch('/api/settings/notify-routes')
    if (res.ok) {
      const d = await res.json()
      setChannels(d.channels ?? [])
      setRoutes(d.routes ?? [])
      setMasters(d.masters ?? null)
    } else if (res.status === 403) {
      setMsg('채널·규칙은 ADMIN 이상만 편집할 수 있습니다.')
    }
    setLoading(false)
  }, [])

  useEffect(() => { void load() }, [load])

  function flash(m: string) {
    setMsg(m)
    setTimeout(() => setMsg(null), 5000)
  }

  async function post(body: Record<string, unknown>, okMsg: string) {
    setBusy(true)
    const res = await fetch('/api/settings/notify-routes', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    })
    const d = await res.json().catch(() => ({}))
    setBusy(false)
    if (!res.ok) { flash(d.error ?? '실패했습니다.'); return false }
    flash(d.note ? `${okMsg} — ${d.note}` : okMsg)
    await load()
    return true
  }

  async function patch(kind: 'channel' | 'route', id: number, body: Record<string, unknown>) {
    setBusy(true)
    const res = await fetch(`/api/settings/notify-routes/${id}?kind=${kind}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    })
    const d = await res.json().catch(() => ({}))
    setBusy(false)
    if (!res.ok) { flash(d.error ?? '수정 실패'); return }
    await load()
  }

  async function remove(kind: 'channel' | 'route', id: number, label: string, extra?: string) {
    if (!confirm(`'${label}'을(를) 삭제하시겠습니까?${extra ? `\n${extra}` : ''}`)) return
    setBusy(true)
    const res = await fetch(`/api/settings/notify-routes/${id}?kind=${kind}`, { method: 'DELETE' })
    const d = await res.json().catch(() => ({}))
    setBusy(false)
    if (!res.ok) { flash(d.error ?? '삭제 실패'); return }
    if (d.deletedRoutes) flash(`채널과 연결 규칙 ${d.deletedRoutes}건을 삭제했습니다.`)
    await load()
  }

  const chip = (on: boolean) => `rounded-full border px-2.5 py-1 text-xs ${on ? 'border-blue-500 bg-blue-50 text-blue-700' : 'text-muted-foreground'}`
  const toggle = <T,>(cur: T[], v: T, set: (x: T[]) => void) => set(cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v])

  function scopeSummary(r: Route): string {
    const parts: string[] = []
    if (r.refTypes.length) parts.push(r.refTypes.map((x) => REF_TYPE_LABELS[x] ?? x).join('·'))
    if (r.queueIds.length) parts.push(`그룹 ${r.queueIds.map((id) => masters?.queues.find((q) => q.id === id)?.name ?? id).join('·')}`)
    if (r.severities.length) parts.push(r.severities.join('·'))
    if (r.statusTo.length) parts.push(`→ ${r.statusTo.map((s) => STATUS_LABELS[s] ?? s).join('·')}`)
    if (r.metrics.length) parts.push(`metric ${r.metrics.join('·')}`)
    return parts.length ? parts.join(' / ') : '전체'
  }

  if (loading) return <p className="py-8 text-center text-sm text-muted-foreground">불러오는 중...</p>

  return (
    <div className="space-y-6">
      {msg && (
        <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-2.5 text-sm text-blue-800 dark:border-blue-800 dark:bg-blue-900/20 dark:text-blue-300">{msg}</div>
      )}

      {/* 채널 */}
      <section className="rounded-xl border bg-card">
        <div className="border-b px-4 py-3">
          <h3 className="text-sm font-semibold text-foreground">발송 채널</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Slack 채널 ID(예: C09XXXXXXXX)를 등록합니다. 등록 후 <b>연결 테스트</b>로 실제 도착을 확인하세요.
            발송 모드가 test면 테스트 채널로 라우팅되고, off면 발송되지 않습니다.
          </p>
        </div>
        <div className="divide-y">
          {channels.map((c) => (
            <div key={c.id} className={`flex flex-wrap items-center gap-2 px-4 py-2.5 ${c.isActive ? '' : 'opacity-50'}`}>
              <span className="text-sm font-medium text-foreground">{c.name}</span>
              <span className="font-mono text-xs text-muted-foreground">{c.slackChannelId}</span>
              {c.description && <span className="text-xs text-muted-foreground">— {c.description}</span>}
              <span className="text-xs text-muted-foreground">규칙 {c._count?.routes ?? 0}건</span>
              <div className="ml-auto flex gap-1.5">
                <button type="button" disabled={busy} onClick={() => post({ kind: 'test', channelId: c.id }, `'${c.name}' 테스트 발송 요청 완료`)}
                  className="rounded-md border px-2 py-1 text-xs text-muted-foreground hover:bg-accent">연결 테스트</button>
                <button type="button" disabled={busy} onClick={() => patch('channel', c.id, { isActive: !c.isActive })}
                  className="rounded-md border px-2 py-1 text-xs text-muted-foreground hover:bg-accent">{c.isActive ? '비활성' : '활성'}</button>
                <button type="button" disabled={busy} onClick={() => remove('channel', c.id, c.name, `연결된 규칙 ${c._count?.routes ?? 0}건도 함께 삭제됩니다.`)}
                  className="rounded-md border border-red-200 px-2 py-1 text-xs text-red-500 hover:bg-red-50">삭제</button>
              </div>
            </div>
          ))}
          {channels.length === 0 && <p className="px-4 py-6 text-center text-sm text-muted-foreground">등록된 채널이 없습니다.</p>}
        </div>
        <div className="flex flex-wrap items-end gap-2 border-t bg-muted/30 px-4 py-3">
          <label className="text-xs text-muted-foreground">표시명
            <input value={chName} onChange={(e) => setChName(e.target.value)} placeholder="운영 공지"
              className="mt-1 block w-36 rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground" />
          </label>
          <label className="text-xs text-muted-foreground">Slack 채널 ID
            <input value={chId} onChange={(e) => setChId(e.target.value)} placeholder="C09XXXXXXXX"
              className="mt-1 block w-40 rounded-md border border-border bg-background px-2 py-1.5 font-mono text-sm text-foreground" />
          </label>
          <label className="min-w-[10rem] flex-1 text-xs text-muted-foreground">설명(선택)
            <input value={chDesc} onChange={(e) => setChDesc(e.target.value)}
              className="mt-1 block w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground" />
          </label>
          <button type="button" disabled={busy}
            onClick={async () => { if (await post({ kind: 'channel', name: chName, slackChannelId: chId, description: chDesc }, '채널을 추가했습니다.')) { setChName(''); setChId(''); setChDesc('') } }}
            className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">+ 채널 추가</button>
        </div>
      </section>

      {/* 규칙 */}
      <section className="rounded-xl border bg-card">
        <div className="border-b px-4 py-3">
          <h3 className="text-sm font-semibold text-foreground">라우팅 규칙</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            조건에 맞는 <b>규칙이 전부 실행</b>됩니다(같은 채널이 중복되면 1건으로 합쳐짐). SLA 정책이 &quot;1개만 승리&quot;인 것과 다릅니다.
            조건을 비우면 전체 대상입니다.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[48rem] text-sm">
            <thead>
              <tr className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
                <th className="px-3 py-2">이벤트</th>
                <th className="px-3 py-2">규칙 · 조건</th>
                <th className="px-3 py-2">채널</th>
                <th className="px-3 py-2">멘션</th>
                <th className="px-3 py-2">시각</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {routes.map((r) => (
                <tr key={r.id} className={`border-b last:border-0 ${r.isActive && r.channel.isActive ? '' : 'opacity-50'}`}>
                  <td className="px-3 py-2 whitespace-nowrap text-xs">{EVENT_LABELS[r.eventType] ?? r.eventType}</td>
                  <td className="px-3 py-2">
                    <p className="text-sm text-foreground">{r.name}</p>
                    <p className="text-xs text-muted-foreground">{scopeSummary(r)}</p>
                  </td>
                  <td className="px-3 py-2 text-xs">
                    {r.channel.name}{!r.channel.isActive && <span className="ml-1 text-amber-600">(채널 비활성)</span>}
                  </td>
                  <td className="px-3 py-2 text-xs">{MENTION_LABELS[r.mentionMode] ?? r.mentionMode}</td>
                  <td className="px-3 py-2 text-xs">
                    {r.eventType === 'DAILY_DIGEST' && r.digestHour != null ? (
                      <select value={r.digestHour} disabled={busy}
                        onChange={(e) => patch('route', r.id, { digestHour: parseInt(e.target.value) })}
                        className="rounded border border-border bg-background px-1 py-0.5 text-xs">
                        {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>)}
                      </select>
                    ) : '—'}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex justify-end gap-1.5">
                      <button type="button" disabled={busy} onClick={() => patch('route', r.id, { isActive: !r.isActive })}
                        className="rounded-md border px-2 py-1 text-xs text-muted-foreground hover:bg-accent">{r.isActive ? '비활성' : '활성'}</button>
                      <button type="button" disabled={busy} onClick={() => remove('route', r.id, r.name)}
                        className="rounded-md border border-red-200 px-2 py-1 text-xs text-red-500 hover:bg-red-50">삭제</button>
                    </div>
                  </td>
                </tr>
              ))}
              {routes.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-6 text-center text-sm text-muted-foreground">규칙이 없습니다 — 규칙이 없으면 Slack 발송이 일어나지 않습니다.</td></tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="border-t bg-muted/30 px-4 py-3">
          {!addRoute ? (
            <button type="button" onClick={() => setAddRoute(true)}
              className="rounded-lg border border-dashed px-3 py-1.5 text-sm text-muted-foreground hover:border-blue-400 hover:text-blue-600">+ 규칙 추가</button>
          ) : (
            <div className="space-y-3">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <label className="text-xs text-muted-foreground">규칙 이름
                  <input value={rName} onChange={(e) => setRName(e.target.value)} placeholder="예: 유지보수 Sev1·2 → CS 긴급"
                    className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground" />
                </label>
                <label className="text-xs text-muted-foreground">이벤트
                  <select value={rEvent} onChange={(e) => setREvent(e.target.value)}
                    className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground">
                    {/* DAILY_DIGEST는 전역 요약 설정(전역 탭)으로 대체 (v2 P4) — 신규 생성 불가, 기존 규칙 표시만 유지 */}
                    {(masters?.events ?? []).filter((e) => e !== 'DAILY_DIGEST').map((e) => <option key={e} value={e}>{EVENT_LABELS[e] ?? e}</option>)}
                  </select>
                </label>
                <label className="text-xs text-muted-foreground">채널
                  <select value={rChannel} onChange={(e) => setRChannel(e.target.value ? parseInt(e.target.value) : '')}
                    className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground">
                    <option value="">선택</option>
                    {channels.filter((c) => c.isActive).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </label>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <p className="text-xs text-muted-foreground">업무 유형 <span className="opacity-70">(비우면 전체)</span></p>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {Object.keys(REF_TYPE_LABELS).map((r) => (
                      <button key={r} type="button" onClick={() => toggle(rRefTypes, r, setRRefTypes)} className={chip(rRefTypes.includes(r))}>{REF_TYPE_LABELS[r]}</button>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Assignment Group <span className="opacity-70">(비우면 전체)</span></p>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {(masters?.queues ?? []).map((q) => (
                      <button key={q.id} type="button" onClick={() => toggle(rQueueIds, q.id, setRQueueIds)} className={chip(rQueueIds.includes(q.id))}>{q.name}</button>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Severity <span className="opacity-70">(비우면 전체)</span></p>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {(masters?.severities ?? []).map((s) => (
                      <button key={s} type="button" onClick={() => toggle(rSeverities, s, setRSeverities)} className={chip(rSeverities.includes(s))}>{s}</button>
                    ))}
                  </div>
                </div>
                {rEvent === 'TICKET_STATUS_CHANGED' && (
                  <div>
                    <p className="text-xs text-muted-foreground">이 상태로 바뀔 때만 <span className="opacity-70">(비우면 전체)</span></p>
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      {(masters?.statuses ?? []).map((s) => (
                        <button key={s} type="button" onClick={() => toggle(rStatusTo, s, setRStatusTo)} className={chip(rStatusTo.includes(s))}>{STATUS_LABELS[s] ?? s}</button>
                      ))}
                    </div>
                  </div>
                )}
                {(rEvent === 'SLA_BREACH' || rEvent === 'SLA_WARNING') && (
                  <div>
                    <p className="text-xs text-muted-foreground">대상 metric <span className="opacity-70">(비우면 전체)</span></p>
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      {(masters?.metrics ?? []).map((m) => (
                        <button key={m} type="button" onClick={() => toggle(rMetrics, m, setRMetrics)} className={chip(rMetrics.includes(m))}>{m}</button>
                      ))}
                    </div>
                  </div>
                )}
                <label className="text-xs text-muted-foreground">멘션
                  <select value={rMention} onChange={(e) => setRMention(e.target.value)}
                    className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground">
                    {(masters?.mentionModes ?? []).map((m) => <option key={m} value={m}>{MENTION_LABELS[m] ?? m}</option>)}
                  </select>
                </label>
                {rEvent === 'DAILY_DIGEST' && (
                  <label className="text-xs text-muted-foreground">발송 시각 (KST)
                    <select value={rHour} onChange={(e) => setRHour(parseInt(e.target.value))}
                      className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground">
                      {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>)}
                    </select>
                  </label>
                )}
              </div>

              <div className="flex gap-2">
                <button type="button" disabled={busy}
                  onClick={async () => {
                    const ok = await post({
                      kind: 'route', name: rName, eventType: rEvent, channelId: rChannel,
                      refTypes: rRefTypes, queueIds: rQueueIds, severities: rSeverities,
                      statusTo: rEvent === 'TICKET_STATUS_CHANGED' ? rStatusTo : [],
                      metrics: rEvent === 'SLA_BREACH' || rEvent === 'SLA_WARNING' ? rMetrics : [],
                      mentionMode: rMention,
                      digestHour: rEvent === 'DAILY_DIGEST' ? rHour : null,
                    }, '규칙을 추가했습니다.')
                    if (ok) { setAddRoute(false); setRName(''); setRRefTypes([]); setRQueueIds([]); setRSeverities([]); setRStatusTo([]); setRMetrics([]) }
                  }}
                  className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">추가</button>
                <button type="button" onClick={() => setAddRoute(false)}
                  className="rounded-lg border px-3 py-1.5 text-sm text-muted-foreground hover:bg-accent">취소</button>
              </div>
            </div>
          )}
        </div>
      </section>
    </div>
  )
}
