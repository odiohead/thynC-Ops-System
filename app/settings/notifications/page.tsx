'use client'

/**
 * 알림 설정 (2026-10-27 재편 — projects/domain_event_notify_design.md)
 *   ① 이벤트: 카탈로그의 모든 이벤트 × 사용 여부 × 규칙(채널·조건·멘션) — "무슨 일이 생기면 어디로 가는가"
 *   ② 채널: Slack 채널 마스터
 *   ③ SLA 기준: 지연 판정 매트릭스(알림이 아니라 기준값)
 *   ④ 공통: 발송 모드·전체 on/off·멘션 킬스위치·SLA 엔진(tick·상한·일일 요약)·자동 종결·메시지 필드·발송 이력
 * 구 3겹 토글(전체/업무 타입별/티켓 이벤트별)은 이벤트 탭의 사용 스위치 + 규칙 조건으로 일원화됨.
 */
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import SlaMatrixTab from './SlaMatrixTab'
import EventsTab from './EventsTab'
import ChannelsTab from './ChannelsTab'

interface FieldDef { key: string; label: string }
interface Config {
  enabled: boolean
  tickInterval: string
  breachTickCap: number
  tickOptions: string[]
  queueMentions: boolean
  sev1Channel: boolean
  digestHour: number // 전역 SLA 요약 시각 (KST 0~23, -1 = off)
  digestChannelId: number | null
  channels: { id: number; name: string; slackChannelId: string }[]
  autoCloseDays: number
  fields: Record<string, string[]>
  catalog: Record<string, FieldDef[]>
  labels: Record<string, string>
  taskTypes: string[]
  mode: string
}
const TICK_LABEL: Record<string, string> = { off: 'OFF', '1m': '1분', '5m': '5분', '10m': '10분', '15m': '15분' }

interface LogRow { id: number; eventType: string; taskType: string | null; refCode: string | null; targetType: string; targetId: string; status: string; error: string | null; payload: { textPreview?: string; dmTo?: string } | null; createdAt: string }
const EVENT_LABEL: Record<string, string> = { task_created: '등록', task_status_changed: '상태변경', delayed: 'SLA', ticket_assigned: '배정', domain_event: '업무 이벤트' }
const STATUS_STYLE: Record<string, string> = { sent: 'bg-green-100 text-green-700', failed: 'bg-red-100 text-red-700', skipped: 'bg-gray-100 text-gray-600' }
const LOG_FILTERS = [{ value: '', label: '전체' }, { value: 'sent', label: '발송' }, { value: 'skipped', label: '스킵' }, { value: 'failed', label: '실패' }]
const MODE_LABEL: Record<string, string> = { off: 'OFF (미발송)', test: 'TEST (테스트 채널로만)', live: 'LIVE (운영 발송)' }

type Tab = 'events' | 'channels' | 'sla' | 'common'

export default function NotificationSettingsPage() {
  const [tab, setTab] = useState<Tab>('events')
  const router = useRouter()
  const [cfg, setCfg] = useState<Config | null>(null)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [authChecked, setAuthChecked] = useState(false)
  const [logs, setLogs] = useState<LogRow[]>([])
  const [logFilter, setLogFilter] = useState('')

  const loadLogs = (status: string) => {
    fetch(`/api/settings/notifications/logs?limit=50${status ? `&status=${status}` : ''}`).then((r) => r.json()).then((data) => setLogs(data.logs ?? [])).catch(() => {})
  }

  useEffect(() => {
    fetch('/api/auth/me').then((r) => r.json()).then((me) => {
      const admin = !!me?.role && (me.role === 'SUPER_ADMIN' || me.role === 'ADMIN')
      setAuthChecked(true)
      if (!admin) { router.push('/'); return }
      fetch('/api/settings/notifications').then((r) => r.json()).then((data) => setCfg(data))
      loadLogs('')
    })
  }, [router])

  function toggleField(taskType: string, key: string) {
    if (!cfg) return
    const cur = cfg.fields[taskType] ?? []
    setCfg({ ...cfg, fields: { ...cfg.fields, [taskType]: cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key] } })
  }

  async function handleSave() {
    if (!cfg) return
    setSaving(true); setMessage('')
    try {
      const res = await fetch('/api/settings/notifications', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: cfg.enabled, tickInterval: cfg.tickInterval, breachTickCap: cfg.breachTickCap, queueMentions: cfg.queueMentions, sev1Channel: cfg.sev1Channel, digestHour: cfg.digestHour, digestChannelId: cfg.digestChannelId, autoCloseDays: cfg.autoCloseDays, fields: cfg.fields }),
      })
      if (res.ok) { router.refresh(); setMessage('저장되었습니다.'); setTimeout(() => setMessage(''), 3000) }
      else setMessage('저장에 실패했습니다.')
    } finally { setSaving(false) }
  }

  if (!authChecked || !cfg) return null
  const num = (label: string, value: number, onChange: (v: number) => void) => (
    <label className="block"><span className="mb-1 block text-xs text-muted-foreground">{label}</span>
      <input type="number" min={0} value={value} disabled={!cfg.enabled} onChange={(e) => onChange(Math.max(0, parseInt(e.target.value) || 0))} className="w-full rounded-lg border bg-background px-2 py-1.5 text-sm text-foreground" /></label>
  )

  return (
    <div className="min-h-screen bg-background">
      <div className={`mx-auto px-4 py-8 sm:px-6 lg:px-8 ${tab === 'common' ? 'max-w-3xl' : 'max-w-6xl'}`}>
        <h1 className="text-2xl font-bold text-foreground mb-1">알림 설정</h1>
        <p className="text-sm text-muted-foreground mb-4">무슨 일이 생기면 어느 Slack 채널로 알릴지를 이벤트 단위로 제어합니다.</p>

        <div className="mb-6 flex gap-1 border-b border-border">
          {([['events', '이벤트'], ['channels', '채널'], ['sla', 'SLA 기준'], ['common', '공통']] as const).map(([key, label]) => (
            <button key={key} type="button" onClick={() => setTab(key)} className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium transition-colors ${tab === key ? 'border-blue-600 text-blue-600' : 'border-transparent text-muted-foreground hover:text-foreground'}`}>{label}</button>
          ))}
          <span className={`ml-auto self-center rounded-full px-2.5 py-0.5 text-xs ${cfg.enabled ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}>전체 {cfg.enabled ? '사용' : '중지'} · {MODE_LABEL[cfg.mode] ?? cfg.mode}</span>
        </div>

        {tab === 'events' && <EventsTab globalEnabled={cfg.enabled} />}
        {tab === 'channels' && <ChannelsTab />}
        {tab === 'sla' && <SlaMatrixTab />}

        {tab === 'common' && (
          <>
            <div className="mb-4 rounded-xl border bg-card p-4">
              <div className="flex items-center justify-between">
                <div><p className="text-sm font-medium text-foreground">발송 모드</p><p className="text-xs text-muted-foreground mt-0.5">서버 환경변수(SLACK_NOTIFY_MODE)로 설정 · 읽기전용</p></div>
                <span className="inline-flex items-center rounded-full bg-muted px-3 py-1 text-xs font-medium text-foreground">{MODE_LABEL[cfg.mode] ?? cfg.mode}</span>
              </div>
            </div>

            <div className="mb-6 rounded-xl border bg-card p-4 space-y-3">
              <label className="flex items-center justify-between cursor-pointer">
                <span><span className="text-sm font-medium text-foreground">알림 전체 사용</span><span className="block text-xs text-muted-foreground mt-0.5">끄면 모든 Slack 알림이 발송되지 않습니다. 이벤트별 사용 여부·채널은 <b>이벤트 탭</b>.</span></span>
                <input type="checkbox" className="h-5 w-5 accent-primary" checked={cfg.enabled} onChange={(e) => setCfg({ ...cfg, enabled: e.target.checked })} />
              </label>
              <div className="grid grid-cols-1 gap-y-2 border-t pt-3 sm:grid-cols-2">
                <label className="flex items-center gap-2 cursor-pointer text-sm text-foreground">
                  <input type="checkbox" className="h-4 w-4 accent-primary" checked={cfg.queueMentions} onChange={(e) => setCfg({ ...cfg, queueMentions: e.target.checked })} disabled={!cfg.enabled} />
                  <span>그룹 멤버 멘션 <span className="text-xs text-muted-foreground">(규칙의 &quot;그룹 멤버&quot; 멘션 킬스위치)</span></span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer text-sm text-foreground">
                  <input type="checkbox" className="h-4 w-4 accent-primary" checked={cfg.sev1Channel} onChange={(e) => setCfg({ ...cfg, sev1Channel: e.target.checked })} disabled={!cfg.enabled} />
                  <span>@channel / @here 멘션 <span className="text-xs text-muted-foreground">(끄면 🚨 강조만)</span></span>
                </label>
              </div>
            </div>

            <div className="mb-6 rounded-xl border bg-card p-4">
              <div className="flex items-center justify-between gap-3">
                <div><p className="text-sm font-medium text-foreground">SLA 점검 주기 (tick)</p><p className="text-xs text-muted-foreground mt-0.5">이 주기로 SLA 초과·임박 알림, 전역 요약, Resolved 자동 종결을 실행합니다.</p></div>
                <select className="rounded-lg border bg-background px-3 py-1.5 text-sm text-foreground" value={cfg.tickInterval} onChange={(e) => setCfg({ ...cfg, tickInterval: e.target.value })} disabled={!cfg.enabled}>
                  {(cfg.tickOptions ?? []).map((o) => <option key={o} value={o}>{TICK_LABEL[o] ?? o}</option>)}
                </select>
              </div>
              <div className="mt-3 flex items-center justify-between gap-3 border-t pt-3">
                <div><p className="text-sm font-medium text-foreground">tick당 즉시 알림 상한</p><p className="text-xs text-muted-foreground mt-0.5">초과 건이 몰려도 채널이 도배되지 않도록 한 주기 발송 건수를 제한합니다.</p></div>
                <input type="number" min={1} value={cfg.breachTickCap} onChange={(e) => setCfg({ ...cfg, breachTickCap: Math.max(1, parseInt(e.target.value) || 20) })} disabled={!cfg.enabled} className="w-20 rounded-lg border bg-background px-2 py-1.5 text-right text-sm text-foreground" />
              </div>
              <div className="mt-3 border-t pt-3">
                <p className="text-sm font-medium text-foreground">SLA 초과 일일 요약 (전역)</p>
                <p className="text-xs text-muted-foreground mt-0.5 mb-2">지정 시각에 초과·임박 티켓 전체를 한 채널로 모아 발송합니다 (이벤트 탭의 &quot;SLA 일일 요약&quot; 사용 스위치가 켜져 있어야 함).</p>
                <div className="flex flex-wrap items-center gap-3">
                  <select className="rounded-lg border bg-background px-3 py-1.5 text-sm text-foreground" value={cfg.digestHour} onChange={(e) => setCfg({ ...cfg, digestHour: parseInt(e.target.value) })} disabled={!cfg.enabled}>
                    <option value={-1}>사용 안 함</option>
                    {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{String(h).padStart(2, '0')}:00 (KST)</option>)}
                  </select>
                  <select className="rounded-lg border bg-background px-3 py-1.5 text-sm text-foreground" value={cfg.digestChannelId ?? ''} onChange={(e) => setCfg({ ...cfg, digestChannelId: e.target.value ? Number(e.target.value) : null })} disabled={!cfg.enabled || cfg.digestHour < 0}>
                    <option value="">요약 채널 선택</option>
                    {(cfg.channels ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                  {cfg.digestHour >= 0 && !cfg.digestChannelId && <span className="text-xs text-amber-600">채널을 선택해야 발송됩니다</span>}
                </div>
              </div>
            </div>

            <div className="mb-6 rounded-xl border bg-card p-4">
              <p className="text-sm font-medium text-foreground mb-1">Resolved 자동 종결</p>
              <p className="text-xs text-muted-foreground mb-3">해결(Resolved) 상태로 N일 지나면 자동 종결합니다. <b>0 = 사용 안 함</b>.</p>
              <div className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-5">{num('자동 종결 (N일)', cfg.autoCloseDays, (v) => setCfg({ ...cfg, autoCloseDays: v }))}</div>
            </div>

            <div className="mb-6">
              <h2 className="text-sm font-semibold text-foreground mb-1">메시지에 포함할 필드 (타입별)</h2>
              <p className="text-xs text-muted-foreground mb-3">티켓 등록·상태 변경 메시지에 추가로 넣을 항목. 업무타입·병원명/제목·상세 링크는 항상 표시됩니다.</p>
              <div className="space-y-3">
                {cfg.taskTypes.map((t) => (
                  <div key={t} className="rounded-xl border bg-card p-4">
                    <p className="text-sm font-medium text-foreground mb-3">{cfg.labels[t]}</p>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3">
                      {(cfg.catalog[t] ?? []).map((f) => (
                        <label key={f.key} className="flex items-center gap-2 cursor-pointer text-sm text-foreground">
                          <input type="checkbox" className="h-4 w-4 accent-primary" checked={(cfg.fields[t] ?? []).includes(f.key)} onChange={() => toggleField(t, f.key)} disabled={!cfg.enabled} /><span>{f.label}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex items-center gap-3">
              <button onClick={handleSave} disabled={saving} className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50">{saving ? '저장 중…' : '저장'}</button>
              {message && <span className="text-sm text-muted-foreground">{message}</span>}
            </div>

            <div className="mt-8">
              <div className="mb-2 flex items-center justify-between">
                <h2 className="text-sm font-semibold text-foreground">최근 발송 이력</h2>
                <div className="flex gap-1">{LOG_FILTERS.map((f) => <button key={f.value} onClick={() => { setLogFilter(f.value); loadLogs(f.value) }} className={`rounded-md px-2.5 py-1 text-xs ${logFilter === f.value ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}>{f.label}</button>)}</div>
              </div>
              <div className="overflow-hidden rounded-xl border bg-card">
                {logs.length === 0 ? <p className="p-4 text-sm text-muted-foreground">이력이 없습니다.</p> : (
                  <div className="divide-y">
                    {logs.map((l) => (
                      <div key={l.id} className="flex items-start gap-3 p-3 text-sm">
                        <span className={`shrink-0 rounded px-1.5 py-0.5 text-xs font-medium ${STATUS_STYLE[l.status] ?? 'bg-muted'}`}>{l.status}</span>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                            <span className="font-medium text-foreground">{EVENT_LABEL[l.eventType] ?? l.eventType}</span>
                            {l.taskType && <span>· {l.taskType}</span>}{l.refCode && <span>· {l.refCode}</span>}
                            <span>· {l.targetType === 'dm' ? `DM${l.payload?.dmTo ? `→${l.payload.dmTo}` : ''}` : '채널'}</span>
                            {l.error && <span className="text-red-500">· {l.error}</span>}
                            <span className="ml-auto">{new Date(l.createdAt).toLocaleString('ko-KR')}</span>
                          </div>
                          {l.payload?.textPreview && <p className="mt-0.5 truncate text-foreground/80">{l.payload.textPreview}</p>}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
