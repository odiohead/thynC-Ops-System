'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import SlaMatrixTab from './SlaMatrixTab'
import RoutesTab from './RoutesTab'

interface FieldDef {
  key: string
  label: string
}
interface Config {
  enabled: boolean
  eventsEnabled: boolean
  tickInterval: string
  breachTickCap: number
  tickOptions: string[]
  queueMentions: boolean
  sev1Channel: boolean
  digestHour: number // 전역 SLA 요약 시각 (KST 0~23, -1 = off)
  digestChannelId: number | null
  channels: { id: number; name: string; slackChannelId: string }[]
  eventToggles: Record<string, boolean> // created/statusChanged/queueTransferred/sevEscalated/assigned
  autoCloseDays: number
  typesEnabled: Record<string, boolean>
  fields: Record<string, string[]>
  catalog: Record<string, FieldDef[]>
  labels: Record<string, string>
  taskTypes: string[]
  mode: string
}

const TICK_LABEL: Record<string, string> = { off: 'OFF', '1m': '1분', '5m': '5분', '10m': '10분', '15m': '15분' }

interface LogRow {
  id: number
  eventType: string
  taskType: string | null
  refCode: string | null
  targetType: string
  targetId: string
  status: string
  error: string | null
  payload: { textPreview?: string; dmTo?: string } | null
  createdAt: string
}

const EVENT_LABEL: Record<string, string> = {
  task_created: '등록',
  task_status_changed: '상태변경',
  delayed: 'SLA',
  ticket_assigned: '배정',
}
const STATUS_STYLE: Record<string, string> = {
  sent: 'bg-green-100 text-green-700',
  failed: 'bg-red-100 text-red-700',
  skipped: 'bg-gray-100 text-gray-600',
}
const LOG_FILTERS = [
  { value: '', label: '전체' },
  { value: 'sent', label: '발송' },
  { value: 'skipped', label: '스킵' },
  { value: 'failed', label: '실패' },
]

const MODE_LABEL: Record<string, string> = {
  off: 'OFF (미발송)',
  test: 'TEST (테스트 채널로만)',
  live: 'LIVE (운영 발송)',
}

export default function NotificationSettingsPage() {
  const [tab, setTab] = useState<'sla' | 'routes' | 'slack'>('sla')
  const router = useRouter()
  const [cfg, setCfg] = useState<Config | null>(null)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [authChecked, setAuthChecked] = useState(false)
  const [logs, setLogs] = useState<LogRow[]>([])
  const [logFilter, setLogFilter] = useState('')

  const loadLogs = (status: string) => {
    fetch(`/api/settings/notifications/logs?limit=50${status ? `&status=${status}` : ''}`)
      .then((r) => r.json())
      .then((data) => setLogs(data.logs ?? []))
      .catch(() => {})
  }

  const numField = (label: string, value: number, onChange: (v: number) => void) => (
    <label className="block">
      <span className="mb-1 block text-xs text-muted-foreground">{label}</span>
      <input
        type="number"
        min={0}
        value={value}
        disabled={!cfg?.enabled}
        onChange={(e) => onChange(Math.max(0, parseInt(e.target.value) || 0))}
        className="w-full rounded-lg border bg-background px-2 py-1.5 text-sm text-foreground"
      />
    </label>
  )

  useEffect(() => {
    fetch('/api/auth/me')
      .then((r) => r.json())
      .then((me) => {
        const admin = !!me?.role && (me.role === 'SUPER_ADMIN' || me.role === 'ADMIN')
        setAuthChecked(true)
        if (!admin) {
          router.push('/')
          return
        }
        fetch('/api/settings/notifications')
          .then((r) => r.json())
          .then((data) => setCfg(data))
        loadLogs('')
      })
  }, [router])

  function toggleField(taskType: string, key: string) {
    if (!cfg) return
    const cur = cfg.fields[taskType] ?? []
    const next = cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key]
    setCfg({ ...cfg, fields: { ...cfg.fields, [taskType]: next } })
  }

  async function handleSave() {
    if (!cfg) return
    setSaving(true)
    setMessage('')
    try {
      const res = await fetch('/api/settings/notifications', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: cfg.enabled, eventsEnabled: cfg.eventsEnabled, tickInterval: cfg.tickInterval, breachTickCap: cfg.breachTickCap, queueMentions: cfg.queueMentions, sev1Channel: cfg.sev1Channel, digestHour: cfg.digestHour, digestChannelId: cfg.digestChannelId, eventToggles: cfg.eventToggles, autoCloseDays: cfg.autoCloseDays, typesEnabled: cfg.typesEnabled, fields: cfg.fields }),
      })
      if (res.ok) {
        router.refresh()
        setMessage('저장되었습니다.')
        setTimeout(() => setMessage(''), 3000)
      } else {
        setMessage('저장에 실패했습니다.')
      }
    } finally {
      setSaving(false)
    }
  }

  if (!authChecked || !cfg) return null

  return (
    <div className="min-h-screen bg-background">
      {/* SLA 기준 탭은 매트릭스 폭이 필요해 컨테이너를 넓게 (알림 설정 탭은 기존 3xl 유지) */}
      <div className={`mx-auto px-4 py-8 sm:px-6 lg:px-8 ${tab === 'slack' ? 'max-w-3xl' : 'max-w-6xl'}`}>
        <h1 className="text-2xl font-bold text-foreground mb-1">알림 설정</h1>
        <p className="text-sm text-muted-foreground mb-4">
          SLA 지연 기준과 Slack 발송 정책을 제어합니다.
        </p>

        {/* 탭 — ① SLA 기준(1.1 P2) / ② Slack 발송(기존). 채널·규칙 탭은 P3, 내부 알림 탭은 P5에서 추가 */}
        <div className="mb-6 flex gap-1 border-b border-border">
          {([
            ['sla', 'SLA 정책'],
            ['routes', '채널·발송 규칙'],
            ['slack', '전역·이력'],
          ] as const).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
                tab === key ? 'border-blue-600 text-blue-600' : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {tab === 'sla' && <SlaMatrixTab />}

        {tab === 'routes' && <RoutesTab />}

        {tab === 'slack' && (
        <>
        {/* 발송 모드 (읽기전용, .env) */}
        <div className="mb-4 rounded-xl border bg-card p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-foreground">발송 모드</p>
              <p className="text-xs text-muted-foreground mt-0.5">서버 환경변수(SLACK_NOTIFY_MODE)로 설정 · 읽기전용</p>
            </div>
            <span className="inline-flex items-center rounded-full bg-muted px-3 py-1 text-xs font-medium text-foreground">
              {MODE_LABEL[cfg.mode] ?? cfg.mode}
            </span>
          </div>
        </div>

        {/* 전역 토글 */}
        <div className="mb-6 rounded-xl border bg-card p-4 space-y-3">
          <label className="flex items-center justify-between cursor-pointer">
            <span>
              <span className="text-sm font-medium text-foreground">알림 전체 사용</span>
              <span className="block text-xs text-muted-foreground mt-0.5">끄면 모든 알림이 발송되지 않습니다.</span>
            </span>
            <input type="checkbox" className="h-5 w-5 accent-primary" checked={cfg.enabled} onChange={(e) => setCfg({ ...cfg, enabled: e.target.checked })} />
          </label>
          <label className="flex items-center justify-between cursor-pointer">
            <span>
              <span className="text-sm font-medium text-foreground">등록·상태변경 알림</span>
              <span className="block text-xs text-muted-foreground mt-0.5">업무 등록 시, 그리고 이후 상태가 바뀔 때(→처리중/보류/완료 등) 채널 알림.</span>
            </span>
            <input type="checkbox" className="h-5 w-5 accent-primary" checked={cfg.eventsEnabled} onChange={(e) => setCfg({ ...cfg, eventsEnabled: e.target.checked })} disabled={!cfg.enabled} />
          </label>
        </div>

        {/* 업무별 알림 사용 */}
        <div className="mb-6 rounded-xl border bg-card p-4">
          <p className="text-sm font-medium text-foreground mb-1">업무별 알림 사용</p>
          <p className="text-xs text-muted-foreground mb-3">끈 업무 타입은 등록·상태변경·지연·DM 모든 알림이 발송되지 않습니다.</p>
          <div className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3">
            {cfg.taskTypes.map((t) => (
              <label key={t} className="flex items-center gap-2 cursor-pointer text-sm text-foreground">
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-primary"
                  checked={cfg.typesEnabled[t] !== false}
                  onChange={(e) => setCfg({ ...cfg, typesEnabled: { ...cfg.typesEnabled, [t]: e.target.checked } })}
                  disabled={!cfg.enabled}
                />
                <span>{cfg.labels[t]}</span>
              </label>
            ))}
          </div>
        </div>

        {/* SLA 알림 엔진 (v2 — tick·상한·전역 요약. DM은 v2에서 폐기, 채널 @멘션으로 대체) */}
        <div className="mb-6 rounded-xl border bg-card p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-foreground">SLA 점검 주기 (tick)</p>
              <p className="text-xs text-muted-foreground mt-0.5">이 주기로 SLA 초과·임박 알림, 전역 요약, Resolved 자동 종결을 실행합니다. 초과 알림은 기한 도래 후 첫 tick에 발송(놓친 건 다음 주기 캐치업).</p>
            </div>
            <select
              className="rounded-lg border bg-background px-3 py-1.5 text-sm text-foreground"
              value={cfg.tickInterval}
              onChange={(e) => setCfg({ ...cfg, tickInterval: e.target.value })}
              disabled={!cfg.enabled}
            >
              {(cfg.tickOptions ?? []).map((o) => <option key={o} value={o}>{TICK_LABEL[o] ?? o}</option>)}
            </select>
          </div>
          <div className="mt-3 flex items-center justify-between gap-3 border-t pt-3">
            <div>
              <p className="text-sm font-medium text-foreground">tick당 즉시 알림 상한</p>
              <p className="text-xs text-muted-foreground mt-0.5">초과 건이 한꺼번에 몰려도 채널이 도배되지 않도록 한 주기 발송 건수를 제한합니다.</p>
            </div>
            <input
              type="number" min={1} value={cfg.breachTickCap}
              onChange={(e) => setCfg({ ...cfg, breachTickCap: Math.max(1, parseInt(e.target.value) || 20) })}
              disabled={!cfg.enabled}
              className="w-20 rounded-lg border bg-background px-2 py-1.5 text-right text-sm text-foreground"
            />
          </div>
          <div className="mt-3 border-t pt-3">
            <p className="text-sm font-medium text-foreground">SLA 초과 일일 요약 (전역)</p>
            <p className="text-xs text-muted-foreground mt-0.5 mb-2">지정 시각에 초과·임박 티켓 전체를 한 채널로 모아 발송합니다 (그룹별 섹션, 하루 1회).</p>
            <div className="flex flex-wrap items-center gap-3">
              <select
                className="rounded-lg border bg-background px-3 py-1.5 text-sm text-foreground"
                value={cfg.digestHour}
                onChange={(e) => setCfg({ ...cfg, digestHour: parseInt(e.target.value) })}
                disabled={!cfg.enabled}
              >
                <option value={-1}>사용 안 함</option>
                {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{String(h).padStart(2, '0')}:00 (KST)</option>)}
              </select>
              <select
                className="rounded-lg border bg-background px-3 py-1.5 text-sm text-foreground"
                value={cfg.digestChannelId ?? ''}
                onChange={(e) => setCfg({ ...cfg, digestChannelId: e.target.value ? Number(e.target.value) : null })}
                disabled={!cfg.enabled || cfg.digestHour < 0}
              >
                <option value="">요약 채널 선택</option>
                {(cfg.channels ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              {cfg.digestHour >= 0 && !cfg.digestChannelId && (
                <span className="text-xs text-amber-600">채널을 선택해야 발송됩니다</span>
              )}
            </div>
          </div>
        </div>

        {/* 티켓 이벤트별 채널 알림 */}
        <div className="mb-6 rounded-xl border bg-card p-4">
          <p className="text-sm font-medium text-foreground mb-1">이벤트별 채널 알림</p>
          <p className="text-xs text-muted-foreground mb-3">티켓 이벤트 종류별로 채널 발송을 제어합니다. 배정 DM·SLA 요약은 아래 별도 토글.</p>
          <div className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
            {([
              ['created', '등록'],
              ['statusChanged', '상태 변경'],
              ['queueTransferred', '그룹 이관'],
              ['sevEscalated', 'Sev1·2 상향'],
              ['assigned', '담당자 배정'],
            ] as const).map(([key, label]) => (
              <label key={key} className="flex items-center gap-2 cursor-pointer text-sm text-foreground">
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-primary"
                  checked={cfg.eventToggles[key] !== false}
                  onChange={(e) => setCfg({ ...cfg, eventToggles: { ...cfg.eventToggles, [key]: e.target.checked } })}
                  disabled={!cfg.enabled || !cfg.eventsEnabled}
                />
                <span>{label}</span>
              </label>
            ))}
          </div>
          <div className="mt-3 grid grid-cols-1 gap-y-2 border-t pt-3 sm:grid-cols-2">
            <label className="flex items-center gap-2 cursor-pointer text-sm text-foreground">
              <input type="checkbox" className="h-4 w-4 accent-primary" checked={cfg.queueMentions} onChange={(e) => setCfg({ ...cfg, queueMentions: e.target.checked })} disabled={!cfg.enabled || !cfg.eventsEnabled} />
              <span>그룹 멤버 멘션 <span className="text-xs text-muted-foreground">(등록·그룹 이관·Sev 상향 시 해당 Assignment Group 멤버 태그)</span></span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer text-sm text-foreground">
              <input type="checkbox" className="h-4 w-4 accent-primary" checked={cfg.sev1Channel} onChange={(e) => setCfg({ ...cfg, sev1Channel: e.target.checked })} disabled={!cfg.enabled || !cfg.eventsEnabled} />
              <span>Sev1 @channel 전체 멘션 <span className="text-xs text-muted-foreground">(끄면 🚨 강조만)</span></span>
            </label>
          </div>
        </div>

        {/* 자동 종결 (구 Sev별 SLA·상태 체류 카드는 v2에서 'SLA 정책' 탭으로 일원화 — 여기선 자동 종결만 남음) */}
        <div className="mb-6 rounded-xl border bg-card p-4">
          <p className="text-sm font-medium text-foreground mb-1">Resolved 자동 종결</p>
          <p className="text-xs text-muted-foreground mb-3">
            해결(Resolved) 상태로 N일 지나면 자동 종결합니다. <b>0 = 사용 안 함</b>.
            SLA 기준(처리 목표·상태 체류)은 <b>SLA 정책 탭</b>에서 관리합니다.
          </p>
          <div className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-5">
            {numField('자동 종결 (N일)', cfg.autoCloseDays, (v) => cfg && setCfg({ ...cfg, autoCloseDays: v }))}
          </div>
        </div>

        {/* 타입별 포함 필드 */}
        <div className="mb-6">
          <h2 className="text-sm font-semibold text-foreground mb-1">메시지에 포함할 필드 (타입별)</h2>
          <p className="text-xs text-muted-foreground mb-3">
            업무타입·병원명/제목·상세 링크는 항상 표시됩니다. 아래에서 추가로 넣을 항목을 선택하세요.
          </p>
          <div className="space-y-3">
            {cfg.taskTypes.map((t) => (
              <div key={t} className="rounded-xl border bg-card p-4">
                <p className="text-sm font-medium text-foreground mb-3">{cfg.labels[t]}</p>
                <div className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3">
                  {(cfg.catalog[t] ?? []).map((f) => {
                    const checked = (cfg.fields[t] ?? []).includes(f.key)
                    return (
                      <label key={f.key} className="flex items-center gap-2 cursor-pointer text-sm text-foreground">
                        <input type="checkbox" className="h-4 w-4 accent-primary" checked={checked} onChange={() => toggleField(t, f.key)} disabled={!cfg.enabled || !cfg.eventsEnabled} />
                        <span>{f.label}</span>
                      </label>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={handleSave}
            disabled={saving}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            {saving ? '저장 중…' : '저장'}
          </button>
          {message && <span className="text-sm text-muted-foreground">{message}</span>}
        </div>

        {/* 발송 이력 */}
        <div className="mt-8">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-foreground">최근 발송 이력</h2>
            <div className="flex gap-1">
              {LOG_FILTERS.map((f) => (
                <button
                  key={f.value}
                  onClick={() => { setLogFilter(f.value); loadLogs(f.value) }}
                  className={`rounded-md px-2.5 py-1 text-xs ${logFilter === f.value ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>
          <div className="overflow-hidden rounded-xl border bg-card">
            {logs.length === 0 ? (
              <p className="p-4 text-sm text-muted-foreground">이력이 없습니다.</p>
            ) : (
              <div className="divide-y">
                {logs.map((l) => (
                  <div key={l.id} className="flex items-start gap-3 p-3 text-sm">
                    <span className={`shrink-0 rounded px-1.5 py-0.5 text-xs font-medium ${STATUS_STYLE[l.status] ?? 'bg-muted'}`}>{l.status}</span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                        <span className="font-medium text-foreground">{EVENT_LABEL[l.eventType] ?? l.eventType}</span>
                        {l.taskType && <span>· {l.taskType}</span>}
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
