'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'

interface FieldDef {
  key: string
  label: string
}
interface SlaRules {
  days: Record<string, number> // SEV1~SEV5 → 목표일 (0 = SLA 미적용)
  warnDays: number
}
type StatusDwell = Record<string, number> // 티켓 상태 → 임계일 (0 = 미사용)
interface Option {
  value: string
  label: string
}
interface Config {
  enabled: boolean
  eventsEnabled: boolean
  delayInterval: string
  activeDelayInterval: string
  dmEnabled: boolean
  assignDm: boolean
  queueMentions: boolean
  sev1Channel: boolean
  eventToggles: Record<string, boolean> // created/statusChanged/queueTransferred/sevEscalated
  autoCloseDays: number
  typesEnabled: Record<string, boolean>
  slaRules: SlaRules
  statusDwell: StatusDwell
  severities: Option[]
  dwellStatuses: Option[]
  fields: Record<string, string[]>
  catalog: Record<string, FieldDef[]>
  labels: Record<string, string>
  taskTypes: string[]
  mode: string
}

const DELAY_OPTIONS = [
  { value: 'off', label: 'OFF' },
  { value: '1h', label: '1시간' },
  { value: '6h', label: '6시간' },
  { value: '24h', label: '매일(24시간)' },
]

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
  delayed: 'SLA·체류',
  ticket_assigned: '배정 DM',
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

  const setSla = (sev: string, v: number) => cfg && setCfg({ ...cfg, slaRules: { ...cfg.slaRules, days: { ...cfg.slaRules.days, [sev]: v } } })
  const setDwell = (status: string, v: number) =>
    cfg && setCfg({ ...cfg, statusDwell: { ...cfg.statusDwell, [status]: v } })
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
        body: JSON.stringify({ enabled: cfg.enabled, eventsEnabled: cfg.eventsEnabled, delayInterval: cfg.delayInterval, dmEnabled: cfg.dmEnabled, assignDm: cfg.assignDm, queueMentions: cfg.queueMentions, sev1Channel: cfg.sev1Channel, eventToggles: cfg.eventToggles, autoCloseDays: cfg.autoCloseDays, typesEnabled: cfg.typesEnabled, slaRules: cfg.slaRules, statusDwell: cfg.statusDwell, fields: cfg.fields }),
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
      <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6 lg:px-8">
        <h1 className="text-2xl font-bold text-foreground mb-1">Slack 알림 설정</h1>
        <p className="text-sm text-muted-foreground mb-6">
          주요 업무 등록·완료 시 Slack 채널로 보내는 알림을 제어합니다.
        </p>

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

        {/* 지연 감지 */}
        <div className="mb-6 rounded-xl border bg-card p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-foreground">SLA 요약 알림 (초과·임박·체류)</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                주기적으로 열린 티켓의 SLA(처리기한)를 점검해 지연 채널에 요약 발송. Resolved 자동 종결도 이 주기에 실행.
                {cfg.activeDelayInterval && cfg.activeDelayInterval !== 'off' && (
                  <span className="ml-1">현재 <b>{DELAY_OPTIONS.find((o) => o.value === cfg.activeDelayInterval)?.label}</b> 간격 실행 중.</span>
                )}
              </p>
            </div>
            <select
              className="rounded-lg border bg-background px-3 py-1.5 text-sm text-foreground"
              value={cfg.delayInterval}
              onChange={(e) => setCfg({ ...cfg, delayInterval: e.target.value })}
              disabled={!cfg.enabled}
            >
              {DELAY_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
          <label className="mt-3 flex items-center justify-between cursor-pointer border-t pt-3">
            <span>
              <span className="text-sm font-medium text-foreground">SLA 초과 담당자 DM</span>
              <span className="block text-xs text-muted-foreground mt-0.5">SLA 초과 티켓의 담당자(Assignee)에게 개인 DM(하루 1회, 해소될 때까지). 계정 이메일로 Slack 자동 매핑.</span>
            </span>
            <input type="checkbox" className="h-5 w-5 accent-primary" checked={cfg.dmEnabled} onChange={(e) => setCfg({ ...cfg, dmEnabled: e.target.checked })} disabled={!cfg.enabled || cfg.delayInterval === 'off'} />
          </label>
          <label className="mt-3 flex items-center justify-between cursor-pointer border-t pt-3">
            <span>
              <span className="text-sm font-medium text-foreground">배정 DM</span>
              <span className="block text-xs text-muted-foreground mt-0.5">티켓 담당자(Assignee)로 배정된 사람에게 즉시 개인 DM.</span>
            </span>
            <input type="checkbox" className="h-5 w-5 accent-primary" checked={cfg.assignDm} onChange={(e) => setCfg({ ...cfg, assignDm: e.target.checked })} disabled={!cfg.enabled} />
          </label>
        </div>

        {/* 티켓 이벤트별 채널 알림 */}
        <div className="mb-6 rounded-xl border bg-card p-4">
          <p className="text-sm font-medium text-foreground mb-1">이벤트별 채널 알림</p>
          <p className="text-xs text-muted-foreground mb-3">티켓 이벤트 종류별로 채널 발송을 제어합니다. 배정 DM·SLA 요약은 아래 별도 토글.</p>
          <div className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
            {([
              ['created', '등록'],
              ['statusChanged', '상태 변경'],
              ['queueTransferred', '큐 이관'],
              ['sevEscalated', 'Sev1·2 상향'],
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
              <span>큐 멤버 멘션 <span className="text-xs text-muted-foreground">(등록·큐 이관·Sev 상향 시 해당 큐 멤버 태그)</span></span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer text-sm text-foreground">
              <input type="checkbox" className="h-4 w-4 accent-primary" checked={cfg.sev1Channel} onChange={(e) => setCfg({ ...cfg, sev1Channel: e.target.checked })} disabled={!cfg.enabled || !cfg.eventsEnabled} />
              <span>Sev1 @channel 전체 멘션 <span className="text-xs text-muted-foreground">(끄면 🚨 강조만)</span></span>
            </label>
          </div>
        </div>

        {/* SLA 목표 (Sev별) */}
        <div className="mb-6 rounded-xl border bg-card p-4">
          <p className="text-sm font-medium text-foreground mb-1">SLA 목표 (Sev별 일수)</p>
          <p className="text-xs text-muted-foreground mb-3">
            티켓 생성 시 처리기한(dueAt) = 생성일 + Sev별 목표일. <b>0 = SLA 미적용</b> (Sev5 백로그 등).
            프로젝트 티켓은 완료예정일이 기한이라 이 규칙을 쓰지 않습니다. Pending 상태는 SLA 판정에서 제외(체류 기준으로 감지).
          </p>
          <div className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-5">
            {cfg.severities.map((s) => (
              <div key={s.value}>{numField(s.label, cfg.slaRules.days[s.value] ?? 0, (v) => setSla(s.value, v))}</div>
            ))}
          </div>
          <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-5">
            {numField('임박 예고 (기한 D-N)', cfg.slaRules.warnDays, (v) => cfg && setCfg({ ...cfg, slaRules: { ...cfg.slaRules, warnDays: v } }))}
            {numField('Resolved 자동 종결 (N일, 0=끔)', cfg.autoCloseDays, (v) => cfg && setCfg({ ...cfg, autoCloseDays: v }))}
          </div>
        </div>

        {/* 티켓 상태 체류 기준 */}
        <div className="mb-6 rounded-xl border bg-card p-4">
          <p className="text-sm font-medium text-foreground mb-1">상태 체류 기준 (일수)</p>
          <p className="text-xs text-muted-foreground mb-3">
            티켓이 특정 상태에 지정 일수 이상 머물면 SLA 요약에 포함합니다. <b>0 = 사용 안 함</b>.
            Pending에 오래 묶인 티켓 감지 등에 사용 — SLA 기한 규칙과 별개로 동작.
          </p>
          <div className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-5">
            {cfg.dwellStatuses.map((s) => (
              <div key={s.value}>{numField(s.label, cfg.statusDwell[s.value] ?? 0, (v) => setDwell(s.value, v))}</div>
            ))}
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
      </div>
    </div>
  )
}
